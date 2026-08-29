import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        firebaseUid: string;
        userId: string;
        organizationId: string;
        displayName: string;
        email: string;
        permissions: string[];
      };
    }
  }
}

export {};
