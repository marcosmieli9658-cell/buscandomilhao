export const pipelineLabels: Record<string, string> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  contacted: "Abordado",
  replied: "Respondeu",
  interested: "Interessado",
  whatsapp_handoff: "Encaminhado ao WhatsApp",
  registered: "Cadastrado",
  active_customer: "Cliente ativo",
  joined_affiliate_group: "Entrou no grupo",
  active_affiliate: "Afiliado ativo",
  generated_customer: "Gerou cliente",
  closed: "Encerrado",
};

export const channelLabels: Record<string, string> = {
  browser_contact_pending: "Contato pelo navegador pendente",
  browser_contact_sent: "Contato enviado pelo navegador",
  waiting_inbound_reply: "Aguardando resposta",
  api_eligible: "Elegível para API",
  api_active: "API oficial ativa",
  api_window_closed: "Janela da API encerrada",
  human_review_required: "Revisão humana necessária",
  do_not_contact: "Não contatar",
  blocked: "Bloqueado",
  completed: "Concluído",
};

export const ownerLabels: Record<string, string> = { browser: "Navegador", api: "API oficial", human: "Operador", none: "Nenhum" };
export const funnelLabels: Record<string, string> = { client: "Cliente", affiliate: "Afiliado" };
export const jobTypeLabels: Record<string, string> = {
  discover_instagram: "Descoberta no Instagram",
  qualify_lead: "Qualificação do lead",
  generate_first_contact: "Geração da abordagem",
  send_browser_dm: "Envio pelo navegador",
  process_inbound: "Processamento da resposta",
  follow_up: "Acompanhamento",
};

export const eventLabels: Record<string, string> = {
  lead_discovered: "Lead descoberto",
  browser_dm_dry_run: "Simulação da primeira mensagem",
  browser_dm_sent: "Primeira mensagem enviada",
  instagram_reply_received: "Resposta recebida no Instagram",
  opt_out: "Pedido de remoção",
  pipeline_qualified: "Lead qualificado",
  pipeline_contacted: "Lead abordado",
  pipeline_replied: "Lead respondeu",
  pipeline_interested: "Lead interessado",
  pipeline_whatsapp_handoff: "Lead encaminhado ao WhatsApp",
  pipeline_closed: "Lead encerrado",
};
