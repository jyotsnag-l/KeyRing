import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'keyring_secret_super_secure_auth';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'parent' | 'delegate' | 'co_signer' | 'sibling' | 'advisor';
    familyId: string;
  };
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token = '';

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.authorization) {
    const qAuth = req.query.authorization as string;
    if (qAuth.startsWith('Bearer ')) {
      token = qAuth.split(' ')[1];
    } else {
      token = qAuth;
    }
  } else if (req.query && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      familyId: decoded.familyId
    };
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid or expired authentication token.' });
  }
}
