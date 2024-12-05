import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { verifyToken } from "../utils/jwtUtils";

export interface AuthRequest extends Request {
  user?: any; 
}

export function user(req: AuthRequest, res: Response, next: NextFunction): void {
  try {
    console.log( "inside video middleware")
    const header = req.headers["authorization"];
    const token1 = header?.split(" ")[1];
    console.log("autherize wala" + token1)
    const token = token1 || req.cookies?.Authentication;
 
    console.log(token)

    if (!token) {
      res.status(401).json({ error: "Unauthorized: No token provided" });
      return; 
    }

    const payload = verifyToken(token) as JwtPayload; 
    console.log(payload)
    if (!payload ) {
      res.status(401).json({ error: "Unauthorized: Invalid token payload" });
      return; 
    }

    req.user = payload; 
    next(); 
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}