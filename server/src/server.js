const app = require("./app");
const env = require("./config/env");

app.listen(env.PORT, () => {
  console.log(`CURA server running on port ${env.PORT}`);
});