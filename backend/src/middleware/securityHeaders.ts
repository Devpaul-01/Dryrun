import helmet from 'helmet';

/**
 * Step 2 of the global middleware stack. Standard security headers
 * (HSTS, X-Content-Type-Options, frame-ancestors/CSP). CORS is configured
 * separately in app.ts and is explicitly NOT relied upon as a security
 * boundary — see middleware/authenticate.ts for why (Bearer JWT is the
 * real trust decision; CORS here is purely browser compatibility).
 */
export const securityHeaders = helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
});
