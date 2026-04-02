# platformOS Liquid Filters

Complete reference of platformOS-specific Liquid filters organized by category.

## Array Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `array_add` | `{{ arr \| array_add: item }}` | Append item to array |
| `array_prepend` | `{{ arr \| array_prepend: item }}` | Prepend item to array |
| `array_delete` | `{{ arr \| array_delete: item }}` | Remove all occurrences of item |
| `array_delete_at` | `{{ arr \| array_delete_at: index }}` | Remove item at index |
| `array_flatten` | `{{ arr \| array_flatten }}` | Flatten nested arrays |
| `array_compact` | `{{ arr \| array_compact }}` | Remove nil/blank values |
| `array_uniq` | `{{ arr \| array_uniq }}` | Remove duplicates |
| `array_shuffle` | `{{ arr \| array_shuffle }}` | Randomize order |
| `array_rotate` | `{{ arr \| array_rotate: n }}` | Rotate array by n positions |
| `array_limit` | `{{ arr \| array_limit: n }}` | Take first n elements |
| `array_select` | `{{ arr \| array_select: key: val }}` | Filter by condition |
| `array_reject` | `{{ arr \| array_reject: key: val }}` | Exclude by condition |
| `array_detect` | `{{ arr \| array_detect: key: val }}` | Find first match |
| `array_find_index` | `{{ arr \| array_find_index: key: val }}` | Find indices of matches |
| `array_map` | `{{ arr \| array_map: 'k1', 'k2' }}` | Extract multiple keys |
| `array_sort_by` | `{{ arr \| array_sort_by: 'key' }}` | Sort by property |
| `array_group_by` | `{{ arr \| array_group_by: 'key' }}` | Group by property |
| `array_in_groups_of` | `{{ arr \| array_in_groups_of: n }}` | Split into groups of n |
| `array_intersect` | `{{ a \| array_intersect: b }}` | Common elements |
| `array_subtract` | `{{ a \| array_subtract: b }}` | Difference |
| `array_sum` | `{{ arr \| array_sum }}` | Sum numeric array |
| `array_include` | `{{ arr \| array_include: el }}` | Check if element exists |
| `array_any` | `{{ arr \| array_any: 'val' }}` | Check if any match |

## Hash Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `hash_merge` | `{{ h1 \| hash_merge: h2 }}` | Merge two hashes |
| `hash_add_key` | `{{ h \| hash_add_key: 'k', 'v' }}` | Add/update key |
| `hash_delete_key` | `{{ h \| hash_delete_key: 'k' }}` | Remove key |
| `hash_dig` | `{{ h \| hash_dig: 'k1', 'k2' }}` | Access nested value |
| `hash_keys` | `{{ h \| hash_keys }}` | Get all keys |
| `hash_values` | `{{ h \| hash_values }}` | Get all values |
| `hash_fetch` | `{{ h \| hash_fetch: 'k' }}` | Get value by key |
| `hash_sort` | `{{ h \| hash_sort }}` | Sort by keys |
| `hash_except` | `{{ h \| hash_except: keys }}` | Exclude keys |
| `hash_diff` | `{{ h1 \| hash_diff: h2 }}` | Compare two hashes |

## Date & Time Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `add_to_time` | `{{ 'now' \| add_to_time: 1, 'w' }}` | Add time (y/mo/w/d/h/m/s) |
| `date_add` | `{{ date \| date_add: 1, 'mo' }}` | Add to date |
| `to_time` | `{{ str \| to_time }}` | Parse to DateTime |
| `to_date` | `{{ str \| to_date }}` | Parse to Date |
| `localize` | `{{ date \| localize: 'long' }}` | Format date (locale-aware) |
| `strftime` | `{{ date \| strftime: '%Y-%m-%d' }}` | Format with strftime |
| `time_diff` | `{{ start \| time_diff: end, 'h' }}` | Duration between dates |
| `is_date_before` | `{{ d1 \| is_date_before: d2 }}` | Compare dates |
| `is_date_in_past` | `{{ date \| is_date_in_past }}` | Check if past |
| `is_parsable_date` | `{{ val \| is_parsable_date }}` | Check if parseable |

## String Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `slugify` | `{{ str \| slugify }}` | URL-safe slug |
| `parameterize` | `{{ str \| parameterize }}` | URL parameter format |
| `titleize` | `{{ str \| titleize }}` | Title Case |
| `humanize` | `{{ str \| humanize }}` | Human-readable |
| `pluralize` | `{{ str \| pluralize: count }}` | Singular/plural |
| `pad_left` | `{{ str \| pad_left: 5, '0' }}` | Left pad |
| `start_with` | `{{ str \| start_with: 'pre' }}` | Check prefix |
| `end_with` | `{{ str \| end_with: 'suf' }}` | Check suffix |
| `matches` | `{{ str \| matches: '[a-z]+' }}` | Regex test |
| `regex_matches` | `{{ str \| regex_matches: pattern }}` | Regex extract |
| `replace_regex` | `{{ str \| replace_regex: pat, rep }}` | Regex replace |
| `strip_liquid` | `{{ str \| strip_liquid }}` | Remove Liquid tags |
| `markdown` | `{{ str \| markdown }}` | Markdown to HTML |
| `html_to_text` | `{{ html \| html_to_text }}` | HTML to plain text |
| `html_safe` | `{{ str \| html_safe }}` | Mark as safe HTML |

## JSON & Encoding Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `json` | `{{ obj \| json }}` | To JSON string |
| `parse_json` | `{{ str \| parse_json }}` | Parse JSON string |
| `base64_encode` | `{{ str \| base64_encode }}` | Base64 encode |
| `base64_decode` | `{{ str \| base64_decode }}` | Base64 decode |
| `url_encode` | `{{ str \| url_encode }}` | URL encode |
| `parse_csv` | `{{ csv \| parse_csv }}` | Parse CSV |
| `to_csv` | `{{ arr \| to_csv }}` | Array to CSV |
| `parse_xml` | `{{ xml \| parse_xml }}` | Parse XML |
| `to_xml` | `{{ hash \| to_xml }}` | Hash to XML |
| `querify` | `{{ hash \| querify }}` | Hash to query string |
| `www_form_encode_rc` | `{{ obj \| www_form_encode_rc }}` | Form encode |

## Validation Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `is_email_valid` | `{{ email \| is_email_valid }}` | Validate email |
| `is_json_valid` | `{{ str \| is_json_valid }}` | Validate JSON |
| `is_parsable_date` | `{{ val \| is_parsable_date }}` | Validate date |
| `is_token_valid` | `{{ token \| is_token_valid: uid }}` | Validate temp token |
| `is_gpg_valid` | `{{ key \| is_gpg_valid }}` | Validate GPG key |
| `verify_access_key` | `{{ key \| verify_access_key }}` | Validate access key |

## Currency & Pricing Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `pricify` | `{{ 19.99 \| pricify: 'USD' }}` | Format price |
| `pricify_cents` | `{{ 1999 \| pricify_cents }}` | Format from cents |
| `amount_to_fractional` | `{{ 10.50 \| amount_to_fractional: 'USD' }}` | To cents (1050) |
| `fractional_to_amount` | `{{ 1050 \| fractional_to_amount }}` | From cents (10.50) |
| `format_number` | `{{ num \| format_number: precision: 2 }}` | Number formatting |
| `advanced_format` | `{{ 3.14 \| advanced_format: '%.2f' }}` | sprintf format |

## Cryptography Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `encrypt` | `{{ data \| encrypt: 'aes-256-cbc', key }}` | Encrypt data |
| `decrypt` | `{{ data \| decrypt: 'aes-256-cbc', key }}` | Decrypt data |
| `digest` | `{{ str \| digest: 'sha256' }}` | Hash digest |
| `compute_hmac` | `{{ data \| compute_hmac: secret }}` | HMAC hash |
| `jwt_encode` | `{{ payload \| jwt_encode: 'HS256', secret }}` | Create JWT |
| `jwt_decode` | `{{ token \| jwt_decode: 'HS256', secret }}` | Decode JWT |
| `jwe_encode` | `{{ json \| jwe_encode: key, alg, enc }}` | JWE encrypt |

## Translation Filter

```liquid
{{ 'app.products.title' | t }}
{{ 'app.greeting' | t: username: 'Mike' }}
{{ 'app.missing' | t: default: 'Fallback text' }}
```

## Asset Filters

```liquid
{{ 'images/logo.png' | asset_url }}    → Full CDN URL
{{ 'styles/main.css' | asset_path }}   → Relative path with cache-bust
```

## Utility Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `uuid` | `{{ '' \| uuid }}` | Generate UUIDv4 |
| `random_string` | `{{ 10 \| random_string }}` | Random alphanumeric |
| `type_of` | `{{ var \| type_of }}` | Get variable type |
| `deep_clone` | `{{ obj \| deep_clone }}` | Deep copy object |
| `download_file` | `{{ url \| download_file }}` | Fetch remote file |
| `useragent` | `{{ ua \| useragent }}` | Parse user agent |
| `video_params` | `{{ url \| video_params }}` | Extract video metadata |
| `videoify` | `{{ url \| videoify }}` | Embed video iframe |
| `url_to_qrcode_svg` | `{{ url \| url_to_qrcode_svg }}` | Generate QR code SVG |
| `to_mobile_number` | `{{ num \| to_mobile_number: 'US' }}` | E.164 format |
| `to_positive_integer` | `{{ val \| to_positive_integer: 1 }}` | Safe integer cast |
| `escape_javascript` | `{{ str \| escape_javascript }}` | JS-safe string |
| `sanitize` | `{{ html \| sanitize }}` | Sanitize HTML |
| `raw_escape_string` | `{{ str \| raw_escape_string }}` | HTML entity escape |
| `new_line_to_br` | `{{ str \| new_line_to_br }}` | Newlines to `<br>` |
| `gzip_compress` | `{{ str \| gzip_compress }}` | Gzip compress |
| `gzip_decompress` | `{{ str \| gzip_decompress }}` | Gzip decompress |
| `expand_url_template` | `{{ tpl \| expand_url_template: params }}` | RFC 6570 URL |
| `extract_url_params` | `{{ url \| extract_url_params: tpl }}` | Extract URL params |
