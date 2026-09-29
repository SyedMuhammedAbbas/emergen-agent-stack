# Production Readiness Checklist

## Application
- [ ] Production build verified
- [ ] Environment configuration verified
- [ ] Secrets configured securely
- [ ] Error handling verified
- [ ] Health/readiness checks available

## Database
- [ ] Production schema verified
- [ ] Migrations reviewed
- [ ] Indexes reviewed
- [ ] Transactions verified
- [ ] Connection pool configured
- [ ] Backup enabled
- [ ] Restore procedure tested

## Security
- [ ] HTTPS
- [ ] CORS reviewed
- [ ] Security headers
- [ ] Rate limiting
- [ ] Authentication
- [ ] Authorization
- [ ] Input validation
- [ ] File upload restrictions
- [ ] Dependency vulnerabilities reviewed
- [ ] Sensitive logging reviewed

## Performance
- [ ] Pagination
- [ ] N+1 checked
- [ ] Slow queries reviewed
- [ ] Caching reviewed
- [ ] Large payloads reviewed
- [ ] Frontend bundle/images reviewed
- [ ] Load test completed where required
- [ ] P95/P99 reviewed where required

## Observability
- [ ] Logs
- [ ] Error monitoring
- [ ] Metrics
- [ ] Uptime monitoring
- [ ] Alerts
- [ ] Request correlation where appropriate

## Deployment
- [ ] CI/CD
- [ ] Staging verification
- [ ] Smoke test
- [ ] Rollback plan
- [ ] Database migration deployment plan
- [ ] Graceful shutdown
- [ ] Deployment documentation

## Recovery
- [ ] Backup retention defined
- [ ] Restore tested
- [ ] RPO defined where required
- [ ] RTO defined where required
- [ ] Disaster recovery procedure documented
