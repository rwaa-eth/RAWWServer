import dotenv from "dotenv";

dotenv.config();

export const SQLite_DB_FILE = process.env.SQLite_DB_FILE;
export const PATH_TO_CERT = process.env.CERT_PATH;
export const INFURA_KEY = process.env.INFURA_KEY;
