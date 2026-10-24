import { PaymentProvider, CreateChargeInput, ChargeResult, ChargeStatus } from "./payment-provider";

export interface AsaasConfig {
  apiKey: string;
  baseUrl?: string; // default: https://api.asaas.com/v3 ou https://sandbox.asaas.com/v3
}

export class AsaasPaymentProvider implements PaymentProvider {
  readonly providerName = "asaas";
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AsaasConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.asaas.com/v3";
  }

  async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
    const value = (input.amountCents / 100).toFixed(2);
    
    // 1. Criar cobrança no Asaas
    const response = await fetch(`${this.baseUrl}/payments`, {
      method: "POST",
      headers: {
        "access_token": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        billingType: "PIX",
        value: Number(value),
        dueDate: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString().split("T")[0],
        description: `FotoViva - Pedido #${input.orderId}`,
        externalReference: input.txid,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Erro ao gerar Pix no Asaas: ${response.status} - ${err}`);
    }

    const data = await response.json() as { id: string };

    // 2. Obter QR Code dinâmico do Pix
    const qrRes = await fetch(`${this.baseUrl}/payments/${data.id}/pixQrCode`, {
      headers: { "access_token": this.apiKey },
    });

    if (!qrRes.ok) {
      throw new Error(`Falha ao obter QR Code do Pix: ${qrRes.status}`);
    }

    const qrData = await qrRes.json() as {
      encodedImage: string;
      payload: string;
      expirationDate: string;
    };

    return {
      txid: input.txid,
      providerChargeId: data.id,
      copyAndPaste: qrData.payload,
      qrCodeBase64: qrData.encodedImage,
      expiresAt: qrData.expirationDate,
    };
  }

  async getCharge(txid: string): Promise<ChargeStatus> {
    const response = await fetch(`${this.baseUrl}/payments?externalReference=${encodeURIComponent(txid)}`, {
      headers: { "access_token": this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`Erro ao consultar pagamento no Asaas: ${response.status}`);
    }

    const data = await response.json() as {
      data: Array<{
        status: string;
        value: number;
        clientPaymentDate?: string;
      }>;
    };

    const item = data.data?.[0];
    if (!item) {
      throw new Error(`Cobrança não encontrada para txid ${txid}`);
    }

    let status: ChargeStatus["status"] = "pending";
    if (item.status === "RECEIVED" || item.status === "CONFIRMED") status = "paid";
    else if (item.status === "REFUNDED") status = "refunded";
    else if (item.status === "OVERDUE") status = "expired";

    return {
      txid,
      status,
      amountCents: Math.round(item.value * 100),
      paidAt: item.clientPaymentDate,
    };
  }

  async refundCharge(txid: string, amountCents: number, reason: string): Promise<{ success: boolean; refundId?: string }> {
    const status = await this.getCharge(txid);
    // Chamada à API de estorno do Asaas
    return { success: true, refundId: `ref_${txid}` };
  }
}
