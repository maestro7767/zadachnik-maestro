import argon2 from "argon2";

/**
 * Пароли хранятся только в виде хеша argon2id (победитель PHC, стойкий к перебору
 * и к атакам на GPU за счёт памяти). Параметры — рекомендация OWASP для argon2id.
 * Пароль в открытом виде никуда не пишется и не логируется.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

/** Проверяет пароль по хешу. Невалидный хеш — это false, а не исключение. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
