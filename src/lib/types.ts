// Tipos de las tablas (escritos a mano; se pueden reemplazar por
// `supabase gen types typescript` cuando el proyecto esté enlazado).

export type AppRole = 'admin' | 'comercial' | 'operaciones';
export type ClientStatus = 'prospecto' | 'activo' | 'inactivo';
export type VisitStatus = 'programada' | 'realizada' | 'cancelada';
export type TaskStatus = 'pendiente' | 'completada' | 'cancelada';
export type TaskPriority = 'baja' | 'media' | 'alta';
export type ItemKind = 'producto' | 'servicio';
export type AdjustmentKind = 'cargo' | 'deduccion';
export type QuoteStatus =
  | 'borrador'
  | 'pendiente_envio'
  | 'enviada'
  | 'negociacion'
  | 'aceptada'
  | 'rechazada'
  | 'vencida'
  | 'cancelada';
export type OrderStatus = 'abierto' | 'cerrado' | 'cancelado';
export type PurchaseStage = 'no_aplica' | 'pendiente' | 'solicitada' | 'comprada';
export type ReceptionStage = 'no_aplica' | 'pendiente' | 'parcial' | 'recibida';
export type PreparationStage = 'pendiente' | 'en_proceso' | 'lista';
export type DeliveryStage = 'pendiente' | 'programada' | 'parcial' | 'entregada';
export type PoStatus = 'borrador' | 'enviada' | 'recibida_parcial' | 'recibida' | 'cancelada';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
}

export interface CompanySettings {
  id: number;
  company_name: string;
  legal_name: string | null;
  tax_id: string | null;
  nrc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  default_tax_rate: number;
  default_currency: string;
  quote_validity_days: number;
  default_quote_terms: string | null;
  quote_footer: string | null;
}

export interface DocumentSequence {
  doc_type: 'quote' | 'order' | 'purchase';
  prefix: string;
  padding: number;
  current_year: number;
  last_value: number;
}

export interface Client {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  industry: string | null;
  status: ClientStatus;
  source: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  needs: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  owner_id: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface Contact {
  id: string;
  client_id: string;
  full_name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  notes: string | null;
  is_demo: boolean;
}

export interface Visit {
  id: string;
  client_id: string;
  contact_id: string | null;
  title: string;
  objective: string | null;
  scheduled_at: string;
  duration_minutes: number;
  location: string | null;
  status: VisitStatus;
  comments: string | null;
  agreements: string | null;
  next_action: string | null;
  next_action_date: string | null;
  owner_id: string | null;
  is_demo: boolean;
  clients?: { name: string } | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  status: TaskStatus;
  priority: TaskPriority;
  client_id: string | null;
  visit_id: string | null;
  quote_id: string | null;
  owner_id: string | null;
  completed_at: string | null;
  is_demo: boolean;
  clients?: { name: string } | null;
  quotes?: { number: string } | null;
}

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  is_demo: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  kind: ItemKind;
  category: string | null;
  brand: string | null;
  unit: string;
  image_url: string | null;
  sale_price: number;
  taxable: boolean;
  is_active: boolean;
  is_demo: boolean;
}

export interface ProductCost {
  product_id: string;
  unit_cost: number;
  supplier_id: string | null;
}

export interface Quote {
  id: string;
  number: string;
  client_id: string;
  contact_id: string | null;
  owner_id: string | null;
  title: string | null;
  status: QuoteStatus;
  requested_at: string;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  tax_rate: number;
  terms: string | null;
  notes: string | null;
  internal_notes: string | null;
  subtotal: number;
  discount_total: number;
  charges_total: number;
  deductions_total: number;
  taxable_base: number;
  tax_total: number;
  total: number;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  closed_at: string | null;
  rejection_reason: string | null;
  next_action: string | null;
  next_action_date: string | null;
  show_images: boolean;
  is_demo: boolean;
  created_at: string;
}

export interface QuoteView extends Quote {
  client_name: string;
  contact_name: string | null;
  owner_name: string | null;
  is_overdue_validity: boolean;
  is_followup_late: boolean;
  order_id: string | null;
  order_number: string | null;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  position: number;
  product_id: string | null;
  kind: ItemKind;
  sku: string | null;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  taxable: boolean;
  line_subtotal: number;
  line_discount: number;
  line_total: number;
}

export interface QuoteAdjustment {
  id: string;
  quote_id: string;
  position: number;
  kind: AdjustmentKind;
  label: string;
  amount: number;
  percent: number | null;
  taxable: boolean;
}

export interface QuoteEvent {
  id: number;
  quote_id: string;
  event_type: 'creada' | 'estado' | 'comentario' | 'seguimiento' | 'pedido';
  from_status: QuoteStatus | null;
  to_status: QuoteStatus | null;
  comment: string | null;
  created_at: string;
  created_by: string | null;
}

export interface Order {
  id: string;
  number: string;
  quote_id: string;
  client_id: string;
  owner_id: string | null;
  status: OrderStatus;
  requires_purchase: boolean;
  purchase_status: PurchaseStage;
  reception_status: ReceptionStage;
  preparation_status: PreparationStage;
  delivery_status: DeliveryStage;
  purchased_at: string | null;
  received_at: string | null;
  prepared_at: string | null;
  delivery_scheduled_for: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  expected_delivery_date: string | null;
  delivery_address: string | null;
  received_by: string | null;
  notes: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  is_demo: boolean;
  created_at: string;
}

export interface OrderView extends Order {
  client_name: string;
  quote_number: string;
  requested_at: string;
  accepted_at: string | null;
  owner_name: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  position: number;
  sku: string | null;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  quantity_received: number;
  quantity_delivered: number;
}

export interface OrderEvent {
  id: number;
  order_id: string;
  stage: string;
  from_value: string | null;
  to_value: string | null;
  comment: string | null;
  created_at: string;
  created_by: string | null;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  order_id: string | null;
  supplier_id: string;
  status: PoStatus;
  ordered_at: string | null;
  expected_at: string | null;
  received_at: string | null;
  total_cost: number;
  tax_rate: number;
  tax_total: number;
  grand_total: number;
  payment_terms: string | null;
  delivery_address: string | null;
  sent_at: string | null;
  created_at: string;
  created_by: string | null;
  notes: string | null;
  is_demo: boolean;
  suppliers?: { name: string } | null;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  order_item_id: string | null;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_cost: number;
  quantity_received: number;
}

export interface DashboardMetrics {
  range: { from: string; to: string };
  clients: { total: number; prospects: number; active: number; new_in_range: number };
  visits: { done_in_range: number; upcoming_7d: number };
  quotes: {
    count_in_range: number;
    amount_in_range: number;
    accepted_amount_in_range: number;
    open_pipeline: number;
    by_status: { status: QuoteStatus; count: number; amount: number }[];
    conversion_rate: number | null;
    decided_count: number;
    followups_late: number;
    validity_expired_open: number;
  };
  tasks: { overdue: number; due_today: number };
  orders: {
    open: number;
    created_in_range: number;
    amount_in_range: number;
    pending_purchase: number;
    pending_reception: number;
    pending_preparation: number;
    pending_delivery: number;
    delivered_in_range: number;
  };
  times: {
    request_to_sent_days: number | null;
    sent_to_accepted_days: number | null;
    accepted_to_delivered_days: number | null;
    request_to_delivered_days: number | null;
  };
  monthly: { month: string; quoted: number; accepted: number }[];
}
