/**
 * Categorias padrão criadas para cada cliente. Os slugs são estáveis e são
 * o único vocabulário que a IA pode devolver; o backend resolve slug -> id.
 */
export type DefaultCategory = { slug: string; name: string; icon: string; keywords: string[] };

export const DEFAULT_EXPENSE_CATEGORIES: DefaultCategory[] = [
  { slug: "mercado", name: "Mercado", icon: "🛒", keywords: ["mercado", "supermercado", "atacadão", "atacadao", "assaí", "assai", "feira", "hortifruti", "sacolão", "sacolao", "açougue", "acougue", "compras do mês", "mercearia"] },
  { slug: "alimentacao", name: "Restaurantes e lanches", icon: "🍽️", keywords: ["restaurante", "lanche", "almoço", "almoco", "jantar", "pizza", "pizzaria", "ifood", "café", "cafe", "cafeteria", "hamburguer", "hambúrguer", "marmita", "marmitex", "sorvete", "açaí", "acai", "lanchonete", "pastel", "churrascaria", "self service", "delivery", "alimentação", "alimentacao", "comida"] },
  { slug: "padaria", name: "Padaria", icon: "🥖", keywords: ["padaria", "pão", "pao", "panificadora", "confeitaria", "bolo"] },
  { slug: "farmacia", name: "Farmácia", icon: "💊", keywords: ["farmácia", "farmacia", "drogaria", "remédio", "remedio", "remédios", "remedios", "medicamento", "vitamina"] },
  { slug: "saude", name: "Saúde", icon: "🩺", keywords: ["médico", "medico", "consulta", "exame", "dentista", "plano de saúde", "plano de saude", "hospital", "clínica", "clinica", "laboratório", "laboratorio", "psicólogo", "psicologo", "fisioterapia", "ótica", "otica", "óculos", "oculos"] },
  { slug: "combustivel", name: "Combustível", icon: "⛽", keywords: ["posto", "gasolina", "etanol", "álcool", "alcool", "diesel", "combustível", "combustivel", "abasteci", "abastecer", "gnv"] },
  { slug: "transporte", name: "Transporte e veículo", icon: "🚗", keywords: ["uber", "99", "ônibus", "onibus", "táxi", "taxi", "estacionamento", "pedágio", "pedagio", "mecânico", "mecanico", "oficina", "ipva", "licenciamento", "passagem", "pneu", "borracharia", "lava jato", "lavagem", "troca de óleo", "seguro do carro", "multa"] },
  { slug: "material-construcao", name: "Material de construção", icon: "🧱", keywords: ["material de construção", "material de construcao", "loja de material", "cimento", "areia", "tijolo", "bloco", "tinta", "ferragens", "ferragem", "madeireira", "telha", "piso", "argamassa", "pedreiro", "eletricista", "encanador", "obra", "reforma", "home center", "leroy"] },
  { slug: "moradia", name: "Moradia", icon: "🏠", keywords: ["aluguel", "condomínio", "condominio", "iptu", "financiamento da casa", "prestação da casa", "diarista", "faxina"] },
  { slug: "casa", name: "Casa e utilidades", icon: "🛋️", keywords: ["móvel", "movel", "móveis", "moveis", "eletrodoméstico", "eletrodomestico", "geladeira", "fogão", "fogao", "utilidades", "cama mesa e banho", "decoração", "decoracao", "produtos de limpeza"] },
  { slug: "agua-energia", name: "Água, luz e gás", icon: "💡", keywords: ["energia", "luz", "conta de luz", "água", "agua", "conta de água", "sanepar", "copel", "gás", "gas", "botijão", "botijao"] },
  { slug: "internet-telefone", name: "Internet e telefone", icon: "📶", keywords: ["internet", "celular", "telefone", "plano de celular", "vivo", "claro", "tim", "oi", "fibra", "recarga"] },
  { slug: "educacao", name: "Educação", icon: "📚", keywords: ["escola", "faculdade", "mensalidade escolar", "curso", "livro", "livros", "material escolar", "apostila", "inglês", "ingles", "matrícula", "matricula"] },
  { slug: "beleza", name: "Beleza e cuidados", icon: "💇", keywords: ["salão", "salao", "cabeleireiro", "cabelo", "barbearia", "barbeiro", "manicure", "unha", "estética", "estetica", "maquiagem", "cosmético", "cosmetico", "sobrancelha", "depilação", "depilacao"] },
  { slug: "academia", name: "Academia e esportes", icon: "🏋️", keywords: ["academia", "crossfit", "pilates", "natação", "natacao", "futebol", "personal", "suplemento", "whey"] },
  { slug: "pet", name: "Pet", icon: "🐾", keywords: ["pet", "pet shop", "petshop", "ração", "racao", "veterinário", "veterinario", "banho e tosa", "cachorro", "gato"] },
  { slug: "filhos", name: "Filhos", icon: "🧸", keywords: ["fralda", "fraldas", "brinquedo", "creche", "babá", "baba", "pediatra", "mesada"] },
  { slug: "lazer", name: "Lazer e viagens", icon: "🎉", keywords: ["cinema", "show", "bar", "viagem", "passeio", "festa", "ingresso", "jogo", "hotel", "pousada", "balada", "cerveja"] },
  { slug: "compras-pessoais", name: "Roupas e compras", icon: "🛍️", keywords: ["roupa", "roupas", "tênis", "tenis", "sapato", "presente", "loja", "shopping", "eletrônico", "eletronico", "perfume", "shopee", "shein", "mercado livre", "amazon"] },
  { slug: "assinaturas", name: "Assinaturas e softwares", icon: "🔁", keywords: ["netflix", "spotify", "assinatura", "adobe", "canva", "chatgpt", "software", "icloud", "google one", "youtube premium", "amazon prime", "capcut", "disney", "hbo", "globoplay"] },
  { slug: "trabalho", name: "Trabalho e negócios", icon: "💼", keywords: ["equipamento", "câmera", "camera", "lente", "microfone", "tráfego", "trafego", "anúncio", "anuncio", "impulsionamento", "freelancer", "contador", "fornecedor", "mercadoria"] },
  { slug: "cartoes", name: "Cartões e tarifas", icon: "💳", keywords: ["anuidade", "juros do cartão", "tarifa do cartão", "tarifa bancária", "tarifa bancaria", "cesta de serviços"] },
  { slug: "emprestimos", name: "Empréstimos e financiamentos", icon: "🏦", keywords: ["empréstimo", "emprestimo", "financiamento", "parcela do carro", "consórcio", "consorcio"] },
  { slug: "impostos", name: "Impostos", icon: "🧾", keywords: ["imposto", "das", "mei", "inss", "irpf", "darf", "taxa"] },
  { slug: "doacoes", name: "Doações e dízimo", icon: "🤲", keywords: ["dízimo", "dizimo", "oferta", "doação", "doacao", "igreja", "vaquinha"] },
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
