import { PlaywrightCdpGateway } from "../src/integrations/browser/gateway";

const keyword = process.argv.slice(2).join(" ").trim();
if (!keyword) throw new Error("Informe o segmento e a cidade da busca.");

const gateway = new PlaywrightCdpGateway();
const profiles = await gateway.discoverProfiles({
  jobId: Date.now(),
  keyword,
  limit: 5,
});

console.log(JSON.stringify({ keyword, count: profiles.length, profiles }, null, 2));
process.exit(0);
