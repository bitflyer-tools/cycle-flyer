export const ceilBy = (n: number, size?: number): number => Math.ceil(n / (size || 1)) * (size || 1);
export const floorBy = (n: number, size?: number): number => Math.floor(n / (size || 1)) * (size || 1);
