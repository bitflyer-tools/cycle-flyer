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
