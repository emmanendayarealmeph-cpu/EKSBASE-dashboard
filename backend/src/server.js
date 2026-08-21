import app from "./app.js";
import { config } from "./config/env.js";
import { KingdeeClient } from "./kingdee/kingdeeClient.js";

const kingdeeClient = new KingdeeClient(config.kingdee);

app.listen(config.port, () => {
  console.log(
    `🚀 Server running on http://localhost:${config.port} (${config.nodeEnv})`
  );

  console.log("Kingdee client configuration loaded successfully.");
});