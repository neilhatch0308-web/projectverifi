export function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">
        Not built yet - this page is a placeholder, not a mockup standing in as
        if it were real. The nav link exists so the app shell shows the full
        intended structure.
      </p>
    </div>
  );
}
