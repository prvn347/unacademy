import { Application, Request, Response, Router } from "express";
import {
  channelInputParser,
  userSignInInputSchema,
  userSignupInputSchema,
} from "../utils/inputParser";
import fs from "fs/promises";
import { PrismaClient } from "@prisma/client";
import z from "zod";
import path from "path";
import bcrypt from "bcryptjs";
import { generateToken } from "../utils/jwtUtils";
// import { cookieConfig } from "../config";
import { AuthRequest, user } from "../middleware/index";
import multer from "multer";

import pdftopic from "pdftopic";
import supabase from "../storage";
const prisma = new PrismaClient();
const app = Router();
const storage = multer.memoryStorage(); // Change to memory storage

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".pdf" && ext !== ".jpg") {
      return cb(new Error("Only pdf and jpg files are allowed."));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // Optional: 50MB file size limit
  }
});

app.get("/ping", async (req: Request, res: Response) => {
  res.send("Pong");
});

app.post("/signup", async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password, username } = req.body;

    const payloadParse = userSignupInputSchema.parse({
      username,
      email,
      password,
    });
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });
    if (existingUser) {
      res.status(409).json({
        message: "Email or username already exists",
      });
      return;
    }
    const hashedPassword = await bcrypt.hashSync(password, 10);
    const newUser = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
      },
    });

    return res.status(201).json({
      message: "User successfully registered",
      userId: newUser.id,
      username: newUser.username,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation errors",
        errors: error.errors,
      });
    }

    console.error("Error during signup:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.post("/signin", async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;

    const payloadParse = userSignInInputSchema.parse({ email, password });

    const existingUser = await prisma.user.findFirst({
      where: {
        email,
      },
    });
    if (!existingUser) {
      res.status(401).json({
        msg: "user not found",
      });
      return;
    }

    const hashedPassword = existingUser?.password;
    const isValidPassword = await bcrypt.compare(
      password,
      hashedPassword as string
    );

    if (!isValidPassword) {
      res.status(400).json({ msg: "incorrect password" });
      return;
    }

    const token = generateToken(existingUser.id);

    res.status(200).json({
      token: token,
      userId: existingUser.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation errors",
        errors: error.errors,
      });
    }

    console.error("Error during singin:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});
app.post(
  "/session",
  user,
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { title } = req.body;
      const userId = req.user;

      const session = await prisma.liveSession.create({
        data: {
          title: title,
          userId: userId,
        },
      });

      res.status(200).json({
        sessionId: session.id,
      });
    } catch (error) {
      res.status(500).json({
        error,
      });
    }
  }
);

app.get("/sessionsResponse", user, async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await prisma.liveSession.findMany();
    const sessionJson = sessions.map((item) => {
      return {
        sessionId: item.id,
        title: item.title,
        startTime: item.startTime,
        status: item.status,
      };
    });
    res.status(200).json(sessionJson);
  } catch (error) {
    res.status(500).json(error);
  }
});
app.post(
  "/session/:sessionId/start",
  user,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const sessionId = req.params.sessionId;
      const sessionExist = await prisma.liveSession.findFirst({
        where: {
          id: sessionId,
        },
      });
      if (!sessionExist) {
        return res.status(404).json({
          msg: "session does not exist",
        });
      }
      if (sessionExist.startTime) {
        return res.status(400).json({
          msg: "session aready started",
        });
      }

      const currentTime = new Date().toISOString();

      const session = await prisma.liveSession.update({
        where: {
          id: sessionId,
        },
        data: {
          startTime: currentTime,
          status: "active",
        },
      });
      res.status(200).json({
        message: "Session started successfully",
      });
    } catch (error) {
      console.error("Error starting session:", error);
      return res.status(500).json({
        msg: "Internal Server Error",
      });
    }
  }
);

app.post(
  "/session/:sessionId/end",
  user,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const sessionId = req.params.sessionId;
      const sessionExist = await prisma.liveSession.findFirst({
        where: {
          id: sessionId,
        },
      });
      if (!sessionExist) {
        return res.status(404).json({
          msg: "session does not exist",
        });
      }
      if (!sessionExist.startTime) {
        return res.status(400).json({
          msg: "session not started started",
        });
      }

      res.status(200).json({
        message: "Session ended successfully",
      });
    } catch (error) {
      console.error("Error ending session:", error);
      return res.status(500).json({
        msg: "Internal Server Error",
      });
    }
  }
);
app.post(
    "/session/:sessionId/slides/pdf",
    upload.single("file"),
    async (req: Request, res: Response): Promise<any> => {
      try {
        const sessionId = req.params.sessionId;
  
        // Validate file upload
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }
  
        console.log("File received, processing PDF");
  
        // Create local image directory for session
        const localImageDir = path.join(__dirname, "test-images");
        const sessionImageDir = path.join(localImageDir, sessionId);
        await fs.mkdir(sessionImageDir, { recursive: true });
  
        // Convert PDF to images
        const pdfBuffer = req.file.buffer;
        console.log("PDF buffer size:", pdfBuffer.length);
  
        const images: Buffer[] | null = await pdftopic.pdftobuffer(pdfBuffer, "all");
        if (!images || images.length === 0) {
          return res.status(500).json({ error: "Failed to process PDF into images" });
        }
        console.log(`PDF processed into ${images.length} images`);
  
        // Upload images to Supabase
        const uploadPromises = images.map(async (imageBuffer, index) => {
          const fileName = `session/${sessionId}/page-${index + 1}.png`;
          
          try {
            // Upload image to Supabase storage
            const { data, error: uploadError } = await supabase.storage
              .from("images")
              .upload(fileName, imageBuffer, {
                contentType: "image/png",
                upsert: true
              });
  
            if (uploadError) {
              console.error(`Failed to upload image ${index + 1}:`, uploadError);
              return null;
            }
  
            // Get public URL for the uploaded image
            const { data: publicData } = supabase.storage
              .from("images")
              .getPublicUrl(fileName);
  
            return publicData.publicUrl;
          } catch (uploadError) {
            console.error(`Error uploading image ${index + 1}:`, uploadError);
            return null;
          }
        });
  
        // Wait for all uploads to complete
        const uploadedUrls = await Promise.all(uploadPromises);
        const validUrls = uploadedUrls.filter(url => url);
  
        // Local file cleanup (optional)
        await Promise.all(
          images.map(async (_, index) => {
            const imagePath = path.join(sessionImageDir, `page-${index + 1}.png`);
            await fs.unlink(imagePath).catch(console.error);
          })
        );
  
        // Respond with uploaded image URLs
        res.json({
          message: "PDF processed successfully",
          totalPages: images.length,
          imageUrls: validUrls
        });
  
      } catch (error) {
        console.error("Error processing PDF upload:", error);
        res.status(500).json({ 
          error: "Internal server error", 
          details: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }
  );
export default app;
