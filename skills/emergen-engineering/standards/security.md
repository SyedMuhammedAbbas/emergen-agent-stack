# Security Standard

## Official references

- OWASP Developer Guide: https://owasp.org/www-project-developer-guide/
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OWASP API Security Top 10: https://owasp.org/www-project-api-security/
- Node.js Security: https://nodejs.org/en/learn/getting-started/security-best-practices

Detailed link index: `references/security.md`

## Secrets

Never:
- hardcode secrets;
- commit credentials;
- expose server secrets to clients;
- log tokens/passwords/API keys.

Provide `.env.example` without real secrets.

## Authentication

Use secure password hashing where passwords exist.
Define token/session expiry.
Protect refresh/session mechanisms.
Provide secure password reset and verification flows where required.

## Authorization

Backend must enforce authorization.
Never rely on hiding frontend buttons.

## Input

Validate and sanitize external input.
Apply size/type limits to uploads.
Never trust client-generated prices, permissions, roles, or payment state.

## HTTP

Configure:
- CORS intentionally;
- secure cookies when used;
- security headers;
- HTTPS in production;
- appropriate CSRF protections for cookie-authenticated applications;
- rate limiting.

## Rate limiting

Apply stronger protection to:
- login;
- password reset;
- OTP;
- public APIs;
- expensive endpoints.

## Files

Validate:
- file size;
- MIME type;
- extension;
- filename;
- access permissions.

Use object storage for appropriate workloads rather than storing large files in application memory/database.

## Logging

Never log:
- passwords;
- authentication tokens;
- secret keys;
- full payment credentials;
- unnecessary sensitive personal information.

## Dependencies

Regularly review dependency vulnerabilities.
Do not install unnecessary packages.

## Threat modeling

For high-risk features, explicitly consider:
- authentication bypass;
- authorization bypass;
- injection;
- data leakage;
- replay;
- abuse/rate attacks;
- insecure file handling;
- webhook spoofing.
