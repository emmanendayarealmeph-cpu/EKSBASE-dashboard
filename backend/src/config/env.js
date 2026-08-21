import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",

kingdee: {
  baseUrl: process.env.KINGDEE_BASE_URL,
  erpAccount: process.env.KINGDEE_ERP_ACCOUNT,
  username: process.env.KINGDEE_USERNAME,
  password: process.env.KINGDEE_PASSWORD,
  languageId: Number(process.env.KINGDEE_LANGUAGE_ID || 1033),
  loginType: Number(process.env.KINGDEE_LOGIN_TYPE || 1),
},
  database: {
    path: process.env.DATABASE_PATH,
  },
};