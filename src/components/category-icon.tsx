import {
  ArrowLeftRight,
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Car,
  Clapperboard,
  Coins,
  CreditCard,
  Croissant,
  Dog,
  Dumbbell,
  FileText,
  Fuel,
  HandCoins,
  HandHeart,
  Handshake,
  Heart,
  House,
  Landmark,
  Lightbulb,
  type LucideIcon,
  Megaphone,
  Package,
  PartyPopper,
  Pill,
  Plane,
  Plus,
  Receipt,
  Repeat,
  Scissors,
  ShoppingBag,
  ShoppingCart,
  Sofa,
  Stethoscope,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Wifi,
  Wrench,
  Zap,
  BrickWall,
  Shirt,
  Gamepad2,
  Music,
  GraduationCap,
  Bus,
  Gift,
  Laptop,
  PiggyBank,
  Wallet,
  CircleHelp,
  ChartPie,
} from "lucide-react";

/*
 * O banco guarda um emoji em categories.icon (é o que o robô usa nas mensagens do WhatsApp).
 * No painel esse emoji vira um ícone de traço, no mesmo estilo dos ícones do menu.
 */
const BY_EMOJI: Record<string, LucideIcon> = {
  "🛒": ShoppingCart,
  "🍽️": UtensilsCrossed,
  "🍽": UtensilsCrossed,
  "🥖": Croissant,
  "💊": Pill,
  "🩺": Stethoscope,
  "⛽": Fuel,
  "🚗": Car,
  "🧱": BrickWall,
  "🏠": House,
  "🛋️": Sofa,
  "🛋": Sofa,
  "💡": Lightbulb,
  "📶": Wifi,
  "📚": BookOpen,
  "💇": Scissors,
  "🏋️": Dumbbell,
  "🏋": Dumbbell,
  "🐾": Dog,
  "🧸": Baby,
  "🎉": PartyPopper,
  "🛍️": ShoppingBag,
  "🛍": ShoppingBag,
  "🔁": Repeat,
  "💼": Briefcase,
  "💳": CreditCard,
  "🏦": Landmark,
  "🧾": Receipt,
  "🤲": HandHeart,
  "📦": Package,
  "💰": Coins,
  "📱": Megaphone,
  "🎬": Clapperboard,
  "🛠️": Wrench,
  "🛠": Wrench,
  "🏷️": Tag,
  "🏷": Tag,
  "🤝": Handshake,
  "📈": TrendingUp,
  "➕": Plus,
  "💵": Banknote,
  "⚡": Zap,
  "📊": ChartPie,
  // Opções da escolha de ícone das categorias criadas pela pessoa
  "🐶": Dog,
  "👕": Shirt,
  "🎮": Gamepad2,
  "🎵": Music,
  "🎓": GraduationCap,
  "🚌": Bus,
  "✈️": Plane,
  "🎁": Gift,
  "💻": Laptop,
  "❤️": Heart,
  "🐷": PiggyBank,
  "👛": Wallet,
  "📄": FileText,
  "🪙": HandCoins,
  "🔄": ArrowLeftRight,
};

/** Ícones que a pessoa pode escolher ao criar uma categoria (o valor salvo continua sendo o emoji). */
export const CATEGORY_ICON_CHOICES: { emoji: string; label: string }[] = [
  { emoji: "📦", label: "Geral" },
  { emoji: "🛒", label: "Compras" },
  { emoji: "🍽️", label: "Comida" },
  { emoji: "🏠", label: "Casa" },
  { emoji: "🚗", label: "Carro" },
  { emoji: "⛽", label: "Combustível" },
  { emoji: "💊", label: "Saúde" },
  { emoji: "🐶", label: "Pet" },
  { emoji: "👕", label: "Roupas" },
  { emoji: "🎮", label: "Jogos" },
  { emoji: "🎵", label: "Música" },
  { emoji: "🎓", label: "Estudos" },
  { emoji: "✈️", label: "Viagem" },
  { emoji: "🎁", label: "Presentes" },
  { emoji: "💻", label: "Tecnologia" },
  { emoji: "💼", label: "Trabalho" },
  { emoji: "❤️", label: "Pessoal" },
  { emoji: "🐷", label: "Reserva" },
  { emoji: "💰", label: "Dinheiro" },
  { emoji: "📈", label: "Investimentos" },
  { emoji: "🧾", label: "Contas" },
  { emoji: "🔁", label: "Assinaturas" },
  { emoji: "🤝", label: "Serviços" },
  { emoji: "🛠️", label: "Manutenção" },
];

export function categoryIcon(emoji?: string | null): LucideIcon {
  if (!emoji) return Tag;
  return BY_EMOJI[emoji] ?? BY_EMOJI[emoji.replace(/️/g, "")] ?? Tag;
}

/** Ícone de categoria. `boxed` desenha o quadradinho de fundo usado nas listas. */
export function CategoryIcon({ icon, size = 16, boxed = false, className = "" }: { icon?: string | null; size?: number; boxed?: boolean; className?: string }) {
  const I = categoryIcon(icon);
  const glyph = <I size={size} strokeWidth={1.75} aria-hidden="true" className={boxed ? "" : `inline-block shrink-0 align-[-0.15em] ${className}`} />;
  if (!boxed) return glyph;
  return <span className={`grid shrink-0 place-items-center ${className}`}>{glyph}</span>;
}

const BY_METHOD: Record<string, LucideIcon> = {
  credito: CreditCard,
  debito: CreditCard,
  pix: Zap,
  dinheiro: Banknote,
  boleto: Receipt,
  transferencia: Landmark,
};

/** Ícone da forma de pagamento (cartão, Pix, dinheiro…). */
export function PaymentMethodIcon({ method, size = 15, className = "" }: { method?: string | null; size?: number; className?: string }) {
  const I = (method && BY_METHOD[method]) || CircleHelp;
  return <I size={size} strokeWidth={1.75} aria-hidden="true" className={`inline-block shrink-0 align-[-0.15em] ${className}`} />;
}
