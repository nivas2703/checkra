# Checkra API contract

## POST /api/analyze

Request:

```json
{
  "title":"Research Paper",
  "text":"...",
  "webSearch":true,
  "aiReview":true
}
```

Response contains:

- similarity.score
- similarity.grade
- similarity.relevantMatches
- similarity.highRisk
- sources.reviewed
- sources.items[]
- aiReview
- queries
- disclaimer

## POST /api/extract

Multipart form field: `file`

Supports PDF, DOCX, TXT, MD and HTML.

## GET /api/health

Returns backend status and whether search/AI providers are configured.
