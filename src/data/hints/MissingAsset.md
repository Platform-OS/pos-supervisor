  Advisory — this check has a high false-positive rate (assets in modules, not-yet-created files).
  DO NOT remove the asset_url filter or strip asset references to silence this check.
  If building a new feature: create the missing asset first, then call validate_code on this file again.
    Assets live in app/assets/.
  If the asset should already exist: browse app/assets/ directly to verify the path. Check for typos.
  DO NOT loop editing the current file — MissingAsset means a different file needs to be created.
