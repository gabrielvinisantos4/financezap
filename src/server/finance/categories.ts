/**
 * Categorias padrão criadas para cada cliente. Os slugs são estáveis e são
 * o único vocabulário que a IA pode devolver; o backend resolve slug -> id.
 */
export type DefaultCategory = { slug: string; name: string; icon: string; keywords: string[] };

export const DEFAULT_EXPENSE_CATEGORIES: DefaultCategory[] = [
  { slug: "alimentacao", name: "Alimentação", icon: "🍽️", keywords: ["restaurante", "lanche", "almoço", "almoco", "jantar", "pizza", "ifood", "padaria", "café", "cafe", "hamburguer", "marmita", "sorvete", "açaí", "acai", "lanchonete"] },
  { slug: "mercado", name: "Mercado", icon: "🛒", keywords: ["mercado", "supermercado", "atacadão", "atacadao", "feira", "hortifruti", "açougue", "acougue", "compras do mês"] },
  { slug: "combustivel", name: "Combustível", icon: "⛽", keywords: ["posto", "gasolina", "etanol", "álcool", "alcool", "diesel", "combustível", "combustivel", "abasteci", "abastecer"] },
  { slug: "transporte", name: "Transporte", icon: "🚗", keywords: ["uber", "99", "ônibus", "onibus", "táxi", "taxi", "estacionamento", "pedágio", "pedagio", "mecânico", "mecanico", "oficina", "ipva", "licenciamento", "passagem"] },
  { slug: "moradia", name: "Moradia", icon: "🏠", keywords: ["aluguel", "condomínio", "condominio", "iptu", "financiamento da casa", "reforma", "material de construção"] },
  { slug: "agua-energia", name: "Água e energia", icon: "💡", keywords: ["energia", "luz", "conta de luz", "água", "agua", "sanepar", "copel", "gás", "gas"] },
  { slug: "internet-telefone", name: "Internet e telefone", icon: "📶", keywords: ["internet", "celular", "telefone", "plano de celular", "vivo", "claro", "tim", "oi", "fibra"] },
  { slug: "saude", name: "Saúde", icon: "🩺", keywords: ["farmácia", "farmacia", "remédio", "remedio", "médico", "medico", "consulta", "exame", "dentista", "plano de saúde", "academia", "hospital"] },
  { slug: "cartoes", name: "Cartões de crédito", icon: "💳", keywords: ["anuidade", "juros do cartão", "tarifa do cartão"] },
  { slug: "emprestimos", name: "Empréstimos", icon: "🏦", keywords: ["empréstimo", "emprestimo", "financiamento", "parcela do carro", "consórcio", "consorcio"] },
  { slug: "assinaturas", name: "Assinaturas e softwares", icon: "🔁", keywords: ["netflix", "spotify", "assinatura", "adobe", "canva", "chatgpt", "software", "icloud", "google one", "youtube premium", "amazon prime", "capcut"] },
  { slug: "trabalho", name: "Trabalho e negócios", icon: "💼", keywords: ["equipamento", "câmera", "camera", "lente", "microfone", "tráfego", "trafego", "anúncio", "anuncio", "impulsionamento", "freelancer", "contador"] },
  { slug: "lazer", name: "Lazer", icon: "🎉", keywords: ["cinema", "show", "bar", "viagem", "passeio", "festa", "ingresso", "jogo"] },
  { slug: "compras-pessoais", name: "Compras pessoais", icon: "🛍️", keywords: ["roupa", "tênis", "tenis", "sapato", "presente", "loja", "shopping", "eletrônico", "eletronico", "perfume"] },
  { slug: "impostos", name: "Impostos", icon: "🧾", keywords: ["imposto", "das", "mei", "inss", "irpf", "darf", "taxa"] },
  { slug: "outros", name: "Outros", icon: "📦", keywords: [] },
];

export const DEFAULT_INCOME_CATEGORIES: DefaultCategory[] = [
  { slug: "salario", name: "Salário", icon: "💰", keywords: ["salário", "salario", "pagamento da empresa", "holerite"] },
  { slug: "marketing", name: "Marketing e social media", icon: "📱", keywords: ["marketing", "social media", "gestão de instagram", "tráfego", "trafego"] },
  { slug: "video", name: "Produção de vídeos", icon: "🎬", keywords: ["vídeo", "video", "filmagem", "edição", "edicao", "reels"] },
  { slug: "servicos", name: "Serviços profissionais", icon: "🛠️", keywords: ["serviço", "servico", "consultoria", "site", "landing page", "projeto"] },
  { slug: "vendas", name: "Vendas", icon: "🏷️", keywords: ["venda", "vendi"] },
  { slug: "comissoes", name: "Comissões", icon: "🤝", keywords: ["comissão", "comissao"] },
  { slug: "rendimentos", name: "Rendimentos financeiros", icon: "📈", keywords: ["rendimento", "juros", "dividendo", "cdb", "poupança", "poupanca"] },
  { slug: "outras-receitas", name: "Outras receitas", icon: "➕", keywords: [] },
];

export const EXPENSE_SLUGS = DEFAULT_EXPENSE_CATEGORIES.map((c) => c.slug);
export const INCOME_SLUGS = DEFAULT_INCOME_CATEGORIES.map((c) => c.slug);

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Classificação por palavras-chave (usada pelo parser de contingência e como desempate). */
export function guessCategorySlug(text: string, kind: "income" | "expense"): string {
  const list = kind === "expense" ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES;
  const lower = ` ${text.toLowerCase()} `;
  let best: { slug: string; len: number } | null = null;
  for (const c of list) {
    for (const k of c.keywords) {
      const re = new RegExp(`(^|[^\\p{L}\\d])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\d]|$)`, "u");
      if (re.test(lower) && (!best || k.length > best.len)) best = { slug: c.slug, len: k.length };
    }
  }
  return best?.slug ?? (kind === "expense" ? "outros" : "outras-receitas");
}
