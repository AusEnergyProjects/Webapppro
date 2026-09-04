param(
  [string]$OutputPath = "src/data/energy-rating-climate-zones.json"
)

$ErrorActionPreference = "Stop"

$calculatorUrl = "https://calculator.energyrating.gov.au/ClimatePopupForAC.aspx?goPageName=Home"
$postcodePath = Join-Path $PSScriptRoot "../src/data/postcode-localities.json"
$resolvedOutputPath = Join-Path $PSScriptRoot "../$OutputPath"
$postcodes = (Get-Content -LiteralPath $postcodePath -Raw | ConvertFrom-Json).PSObject.Properties.Name | Sort-Object
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$page = Invoke-WebRequest -Uri $calculatorUrl -WebSession $session -UseBasicParsing
$baseFields = @{}

foreach ($name in "__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION") {
  $pattern = 'name="' + [regex]::Escape($name) + '"[^>]*value="([^"]*)"'
  $match = [regex]::Match($page.Content, $pattern)
  if (-not $match.Success) {
    throw "The Energy Rating Calculator response did not contain $name."
  }
  $baseFields[$name] = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value)
}

$zones = [ordered]@{}
$missing = [System.Collections.Generic.List[string]]::new()

for ($index = 0; $index -lt $postcodes.Count; $index += 1) {
  $postcode = $postcodes[$index]
  $fields = @{}
  foreach ($key in $baseFields.Keys) {
    $fields[$key] = $baseFields[$key]
  }
  $fields["__EVENTTARGET"] = "txtPostcode"
  $fields["__EVENTARGUMENT"] = "OnTextChanged"
  $fields["txtPostcode"] = $postcode
  $fields["txtClimateZone"] = ""

  $response = Invoke-WebRequest -Uri $calculatorUrl -Method Post -Body $fields -WebSession $session -UseBasicParsing
  $tag = [regex]::Match($response.Content, '<input[^>]+id="txtClimateZone"[^>]*>').Value
  $match = [regex]::Match($tag, 'value="([^"]*)"')
  $zone = $match.Groups[1].Value.Trim().ToLowerInvariant()
  $choices = @()
  if (-not $zone) {
    $choices = @([regex]::Matches(
      $response.Content,
      '<option(?:\s+selected="selected")?\s+value="(Hot|Average|Cold)"'
    ) | ForEach-Object { $_.Groups[1].Value.Trim().ToLowerInvariant() })
    $selectedOption = [regex]::Match(
      $response.Content,
      '<option\s+selected="selected"\s+value="(Hot|Average|Cold)"'
    )
    $zone = $selectedOption.Groups[1].Value.Trim().ToLowerInvariant()
  }
  if ($zone -in "hot", "average", "cold") {
    if (-not $choices.Count) {
      $choices = @($zone)
    }
    $zones[$postcode] = [ordered]@{
      band = $zone
      choices = $choices
    }
  } else {
    $missing.Add($postcode)
  }

  if (($index + 1) % 100 -eq 0 -or $index + 1 -eq $postcodes.Count) {
    Write-Output "Checked $($index + 1) of $($postcodes.Count) postcodes"
  }
  Start-Sleep -Milliseconds 25
}

$artifact = [ordered]@{
  source = $calculatorUrl
  retrievedAt = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  zones = $zones
}
$artifact | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $resolvedOutputPath -Encoding utf8 -NoNewline
Write-Output "Saved $($zones.Count) postcode climate bands to $resolvedOutputPath"
if ($missing.Count) {
  Write-Warning "No climate band was returned for $($missing.Count) local postcodes: $($missing -join ', ')"
}
