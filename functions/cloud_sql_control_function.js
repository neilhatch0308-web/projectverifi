// ============================================================
// Cloud SQL Control Panel — Cloud Function (2nd gen, Node.js 20)
// Controls instance state via the Cloud SQL ADMIN API — this is a
// control-plane call, completely separate from connecting to the
// database itself. Works even when the instance is fully stopped.
//
// NETWORKING NOTE: this function does NOT need Direct VPC egress or
// any VPC connector. It never talks to the database on its private
// IP — it only calls the public Cloud SQL Admin REST API (which is
// how you can start/stop/check status even with no public IP on the
// instance itself). Direct VPC egress is only needed by whichever
// service actually queries the database (e.g. a future Cloud Run
// backend connecting to Postgres on port 5432) — see BUILD_GUIDE.md.
//
// Deploy:
//   gcloud functions deploy sql-control \
//     --gen2 --runtime=nodejs20 --region=europe-west2 \
//     --trigger-http --no-allow-unauthenticated \
//     --set-env-vars PROJECT_ID=your-project,INSTANCE_ID=your-instance
//
// The function itself should require Firebase Auth — verify the
// ID token before doing anything, since this endpoint can start
// billable compute.
// ============================================================

const { google } = require("googleapis");
const { getAuth } = require("firebase-admin/auth");
const { initializeApp } = require("firebase-admin/app");

initializeApp();

const PROJECT_ID = process.env.PROJECT_ID;
const INSTANCE_ID = process.env.INSTANCE_ID;

async function getSqlAdminClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/sqlservice.admin"],
  });
  const authClient = await auth.getClient();
  return google.sqladmin({ version: "v1beta4", auth: authClient });
}

async function verifyCaller(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new Error("Missing bearer token");
  const decoded = await getAuth().verifyIdToken(token);
  return decoded.uid;
}

exports.sqlControl = async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*"); // tighten to your Hosting domain in production
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).send("");
  }

  try {
    await verifyCaller(req); // throws if not a valid, authenticated user
    const sqladmin = await getSqlAdminClient();

    if (req.method === "GET") {
      // ---- Status check — works whether instance is running or stopped ----
      const { data } = await sqladmin.instances.get({
        project: PROJECT_ID,
        instance: INSTANCE_ID,
      });
      const ipAddresses = (data.ipAddresses || []).map((ip) => ip.type); // e.g. ['PRIVATE'] — should never include 'PRIMARY' (public)
      return res.status(200).json({
        state: data.state,                          // RUNNABLE | STOPPED | PENDING_CREATE | ...
        activationPolicy: data.settings.activationPolicy, // ALWAYS | NEVER
        tier: data.settings.tier,
        ipTypes: ipAddresses,
        hasPublicIp: ipAddresses.includes("PRIMARY"),
      });
    }

    if (req.method === "POST") {
      const { action } = req.body; // 'start' | 'stop'
      if (!["start", "stop"].includes(action)) {
        return res.status(400).json({ error: "action must be 'start' or 'stop'" });
      }

      const { data } = await sqladmin.instances.patch({
        project: PROJECT_ID,
        instance: INSTANCE_ID,
        requestBody: {
          settings: {
            activationPolicy: action === "start" ? "ALWAYS" : "NEVER",
          },
        },
      });

      return res.status(202).json({
        message: `Instance ${action} requested`,
        operationId: data.name, // poll sqladmin.operations.get with this if you want a progress indicator
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ error: err.message });
  }
};
