import rateLimit from "express-rate-limit";

/**
 * General API rate limiter — applied to all /api/* routes.
 * Allows up to 200 requests per minute per IP.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiadas peticiones. Intenta de nuevo en un minuto." },
  skip: (req) => req.method === "OPTIONS",
});

/**
 * Strict rate limiter for authentication endpoints.
 * Allows up to 10 attempts per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos." },
  skipSuccessfulRequests: true,
});
