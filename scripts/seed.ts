import { database } from "../src/db/client";
import { discoverLead } from "../src/features/leads/service";

const demoProfiles = [
  { instagramHandle: "@clinica_exemplo", displayName: "Clínica Exemplo", bio: "Clínica fictícia no Vale do Paraíba", segment: "clínicas e consultórios", score: 82 },
  { instagramHandle: "@imobiliaria_exemplo", displayName: "Imobiliária Exemplo", bio: "Imóveis fictícios em São José dos Campos", segment: "imobiliárias e corretores", score: 76 },
];

for (const profile of demoProfiles) discoverLead({ funnel: "client", source: "demo_seed", location: "São José dos Campos, SP", ...profile });
console.log(`${demoProfiles.length} fictional demo leads are available.`);
database.sqlite.close();
