export interface ChildOrderEvent {
    child_order_acceptance_id: string;
    child_order_id: string;
    event_date: string;
    event_type: string;
    price?: number;
    product_code: string;
    side?: string;
    size?: number;
}

export interface ParentOrderEvent {
    event_date: string;
    event_type: string;
    parent_order_acceptance_id: string;
    parent_order_id: string;
    product_code?: string;
}

export const isExecution = (event: ChildOrderEvent): boolean => event.event_type === "EXECUTION";
