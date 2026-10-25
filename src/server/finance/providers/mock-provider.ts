import { PaymentProvider, CreateChargeInput, ChargeResult, ChargeStatus } from "./payment-provider.js";

/**
 * Provedor simulado para desenvolvimento local e suíte de testes.
 * Gera dados compatíveis com o padrão Pix do Banco Central.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly providerName = "mock";
  private charges = new Map<string, ChargeStatus>();

  async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
    const payload = `00020126580014BR.GOV.BCB.PIX0136${input.txid}5204000053039865406${(input.amountCents / 100).toFixed(2)}5802BR5908FotoViva6009Sao Paulo62070503***6304`;
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();

    this.charges.set(input.txid, {
      txid: input.txid,
      status: "pending",
      amountCents: input.amountCents,
    });

    return {
      txid: input.txid,
      providerChargeId: `mock_${input.txid}`,
      copyAndPaste: payload,
      qrCodeBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      expiresAt,
    };
  }

  async getCharge(txid: string): Promise<ChargeStatus> {
    const charge = this.charges.get(txid);
    if (!charge) throw new Error(`Cobrança mock ${txid} não encontrada`);
    return charge;
  }

  async refundCharge(txid: string, _amountCents: number, _reason: string): Promise<{ success: boolean; refundId?: string }> {
    const charge = this.charges.get(txid);
    if (charge) charge.status = "refunded";
    return { success: true, refundId: `ref_${txid}` };
  }
}
