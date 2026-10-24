/**
 * Interface unificada para Provedores Pix (Asaas, Efí, Mercado Pago ou Simulado).
 */

export interface CreateChargeInput {
  orderId: string;
  txid: string;
  amountCents: number;
  customer: {
    name?: string;
    cpfCnpj?: string;
    email?: string;
    phone?: string;
  };
  expiresInSeconds: number;
}

export interface ChargeResult {
  txid: string;
  providerChargeId: string;
  copyAndPaste: string;
  qrCodeBase64: string;
  expiresAt: string;
}

export interface ChargeStatus {
  txid: string;
  status: "pending" | "paid" | "expired" | "failed" | "refunded";
  amountCents: number;
  paidAt?: string;
  endToEndId?: string;
}

export interface PaymentProvider {
  readonly providerName: string;
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
  getCharge(txid: string): Promise<ChargeStatus>;
  refundCharge(txid: string, amountCents: number, reason: string): Promise<{ success: boolean; refundId?: string }>;
}
