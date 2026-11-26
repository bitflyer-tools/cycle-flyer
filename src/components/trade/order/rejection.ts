import {Response} from "@cycle/http";

export const isOrderRejection = (response?: Response): boolean => {
    const status = response?.status ?? 0;
    const hasDefinitiveStatus = (status >= 200 && status < 300)
        || (status >= 400 && status < 500 && status !== 408);
    if (!response || !hasDefinitiveStatus) return false;
    try {
        const body = JSON.parse(response.text);
        return Number.isFinite(body?.status) && body.status < 0
            && typeof body.error_message === "string" && body.error_message.trim().length > 0;
    } catch {
        return false;
    }
};

export type AcceptanceIdField = "child_order_acceptance_id" | "parent_order_acceptance_id";

export const hasOrderAcceptanceId = (response: Response, field: AcceptanceIdField): boolean => {
    if (!(response.status >= 200 && response.status < 300)) return false;
    try {
        const id = JSON.parse(response.text)?.[field];
        return typeof id === "string" && id.trim().length > 0;
    } catch {
        return false;
    }
};
