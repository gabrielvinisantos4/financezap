-- Categorias de despesa mais detalhadas (farmácia, material de construção, padaria...).
-- 1) Atualiza nome/ícone das categorias do sistema que já existem;
-- 2) cria as novas para todos os clientes;
-- 3) move lançamentos antigos óbvios para a categoria nova (só os do sistema, sem tocar no que o cliente escolheu à mão no painel).
SELECT set_config('app.bypass_rls', 'on', true);--> statement-breakpoint
CREATE TEMP TABLE _new_cats (slug text, name text, icon text) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO _new_cats VALUES
  ('mercado', 'Mercado', '🛒'),
  ('alimentacao', 'Restaurantes e lanches', '🍽️'),
  ('padaria', 'Padaria', '🥖'),
  ('farmacia', 'Farmácia', '💊'),
  ('saude', 'Saúde', '🩺'),
  ('combustivel', 'Combustível', '⛽'),
  ('transporte', 'Transporte e veículo', '🚗'),
  ('material-construcao', 'Material de construção', '🧱'),
  ('moradia', 'Moradia', '🏠'),
  ('casa', 'Casa e utilidades', '🛋️'),
  ('agua-energia', 'Água, luz e gás', '💡'),
  ('internet-telefone', 'Internet e telefone', '📶'),
  ('educacao', 'Educação', '📚'),
  ('beleza', 'Beleza e cuidados', '💇'),
  ('academia', 'Academia e esportes', '🏋️'),
  ('pet', 'Pet', '🐾'),
  ('filhos', 'Filhos', '🧸'),
  ('lazer', 'Lazer e viagens', '🎉'),
  ('compras-pessoais', 'Roupas e compras', '🛍️'),
  ('assinaturas', 'Assinaturas e softwares', '🔁'),
  ('trabalho', 'Trabalho e negócios', '💼'),
  ('cartoes', 'Cartões e tarifas', '💳'),
  ('emprestimos', 'Empréstimos e financiamentos', '🏦'),
  ('impostos', 'Impostos', '🧾'),
  ('doacoes', 'Doações e dízimo', '🤲'),
  ('outros', 'Outros', '📦');--> statement-breakpoint
UPDATE categories c SET name = n.name, icon = n.icon
  FROM _new_cats n
 WHERE c.kind = 'expense' AND c.is_system AND c.slug = n.slug AND (c.name <> n.name OR c.icon <> n.icon);--> statement-breakpoint
INSERT INTO categories (user_id, kind, name, slug, icon, is_system)
SELECT u.id, 'expense', n.name, n.slug, n.icon, true
  FROM users u CROSS JOIN _new_cats n
 WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.user_id = u.id AND c.kind = 'expense' AND c.slug = n.slug);--> statement-breakpoint
UPDATE transactions t SET category_id = nc.id
  FROM categories oc, categories nc
 WHERE t.category_id = oc.id AND oc.user_id = t.user_id AND nc.user_id = t.user_id AND nc.kind = 'expense'
   AND t.kind = 'expense' AND t.source = 'whatsapp'
   AND (
     (oc.slug = 'saude' AND nc.slug = 'farmacia' AND (t.description || ' ' || coalesce(t.merchant,'')) ~* '(farm[aá]cia|drogaria|rem[eé]dio)')
  OR (oc.slug IN ('moradia','outros') AND nc.slug = 'material-construcao' AND (t.description || ' ' || coalesce(t.merchant,'')) ~* '(material de constru|cimento|tijolo|madeireira|ferrage)')
  OR (oc.slug = 'alimentacao' AND nc.slug = 'padaria' AND (t.description || ' ' || coalesce(t.merchant,'')) ~* '(padaria|panificadora)')
  OR (oc.slug = 'saude' AND nc.slug = 'academia' AND (t.description || ' ' || coalesce(t.merchant,'')) ~* 'academia')
   );
