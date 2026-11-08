export function publicResponse(_key: string, next: () => Promise<Response>): Promise<Response> { return next(); }
