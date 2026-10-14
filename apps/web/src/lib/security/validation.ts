export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'Ожидается объект.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 320, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000]/u.test(value))
    throw new AppError(400, 'Проверьте заполнение полей.');
  return value;
}
export function identifier(value: unknown): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw new AppError(400, 'Некорректный идентификатор.');
  return n;
}
export function ids(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new AppError(400, 'Выберите от 1 до 200 писем.');
  return [...new Set(value.map(identifier))];
}
export function email(value: unknown): string {
  const s = text(value).trim();
  if (!/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+$/u.test(s)) throw new AppError(400, 'Некорректный почтовый адрес.');
  return s;
}
export function domain(value: unknown): string {
  const s = text(value,253).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s)) throw new AppError(400,'Некорректный домен. Используйте ASCII/Punycode.');
  return s;
}
export function account(value: unknown): string {
  const s = text(value,64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(s)) throw new AppError(400,'Некорректное имя аккаунта.');
  return s;
}
export function flag(value: unknown): string {
  if (value !== '\\seen' && value !== '\\flagged' && value !== '\\answered' && value !== '$forwarded') throw new AppError(400,'Недопустимый флаг.');
  return value;
}
export function filename(value: unknown): string {
  const name = text(value,255);
  if (/[\/\\\r\n\x00-\x1f]/u.test(name) || name === '.' || name === '..') throw new AppError(400,'Некорректное имя файла.');
  return name;
}
export async function body(request: Request, limit = 24 * 1024 * 1024): Promise<Record<string,unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError(415,'Требуется JSON.');
  if (Number(request.headers.get('content-length')) > limit) throw new AppError(413,'Превышен размер запроса.');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400,'Пустой запрос.');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length;
      if (size > limit) { await reader.cancel(); throw new AppError(413,'Превышен размер запроса.'); } chunks.push(value); }
    try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (e) { if (e instanceof AppError) throw e; throw new AppError(400,'Некорректный JSON.'); }
  } finally { reader.releaseLock(); }
}
