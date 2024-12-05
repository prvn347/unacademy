import express from "express";
import cors from "cors";
import routes from "./routes/index"
import cookieParser from "cookie-parser"
const app = express();
const PORT = 3000;

const startServer = () => {
  app.use(express.json());
  app.use(cors());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser())
  app.use("/api/v1", routes);


  app.listen(PORT, () => {
    console.log(`server is listening on port ${PORT}`);
  });
};

startServer();