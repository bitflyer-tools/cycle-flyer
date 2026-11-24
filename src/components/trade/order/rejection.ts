import {Response} from "@cycle/http";

// 408 and 5xx responses (gateway timeouts, upstream errors) leave it unclear whether the
// exchange received the write, so only other 4xx statuses count as a definitive rejection.
export const isDefinitiveRejectionStatus = (status?: number): boolean =>
    status !== undefined && status >= 400 && status < 500 && status !== 408;

export const isOrderRejection = (response?: Response): boolean => {
    const status = response?.status ?? 0;
    const hasDefinitiveStatus = (status >= 200 && status < 300) || isDefinitiveRejectionStatus(status);
    if (!response || !hasDefinitiveStatus) return false;
    try {
        const body = JSON.parse(response.text);
        return Number.isFinite(body?.status) && body.status < 0
            && typeof body.error_message === "string" && body.error_message.trim().length > 0;
    } catch {
        return false;
    }
};
