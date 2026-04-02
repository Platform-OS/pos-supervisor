# Search by Content

You can search for pages based on their rendered content. This is useful for implementing features such as site-wide search or FAQ search functionality.

## Limitations

Search operates on the rendered page version. Pages marked as searchable cannot depend on dynamic data such as:
- `current_user`
- URL parameters
- Session-dependent content

Only static content will be indexed and searchable.

## Configuration

Enable search for a page by setting the `searchable` property to `true` in the page's front matter:

```yaml
---
searchable: true
---
```

## GraphQL Query

Use a GraphQL query to search pages by content:

```graphql
query search_page(
  $value: String
) {
  pages: pages(
    filter: {
      content: {
        contains: $value
      }
    }
  ) {
    total_entries
    results {
      slug
      content
    }
  }
}
```

### Query Parameters

- `$value`: The search string to match against page content

### Response Fields

- `total_entries`: Total number of matching pages
- `results`: Array of matching pages
  - `slug`: Page slug
  - `content`: Page content containing the search term

## Example Usage

```graphql
query search_faq($term: String) {
  pages(
    filter: {
      content: { contains: $term }
    }
  ) {
    results {
      slug
      content
    }
  }
}
```

With variables:
```json
{
  "term": "shipping"
}
```
