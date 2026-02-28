# Создание структуры Vault для VoiceZettel
Write-Host "Создание структуры VoiceZettel Vault..." -ForegroundColor Cyan

$vaultPath = "C:\Users\nasty\Desktop\voicezettel\obsidian-vault"

# Создаём папки
$folders = @(
    "00_Inbox",
    "10_Zettels",
    "20_MOC",
    "Sessions",
    "Archive"
)

foreach ($folder in $folders) {
    $path = Join-Path $vaultPath $folder
    if (!(Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Write-Host "  + $folder" -ForegroundColor Green
    } else {
        Write-Host "  = $folder (exists)" -ForegroundColor Yellow
    }
}

# MOC заметки
$mocs = @{
    "MOC — Продажи и маркетинг" = @"
---
type: moc
---
# Продажи и маркетинг
Карта связей: лиды, воронки, автоматизация продаж, ценообразование, конверсия.
"@
    "MOC — Бизнес-идеи" = @"
---
type: moc
---
# Бизнес-идеи
Карта связей: стартапы, монетизация, бизнес-модели, инвестиции.
"@
    "MOC — Личное развитие" = @"
---
type: moc
---
# Личное развитие
Карта связей: навыки, привычки, обучение, здоровье, продуктивность.
"@
}

foreach ($name in $mocs.Keys) {
    $path = Join-Path $vaultPath "20_MOC\$name.md"
    if (!(Test-Path $path)) {
        $mocs[$name] | Out-File -Encoding utf8 $path
        Write-Host "  + MOC: $name" -ForegroundColor Green
    }
}

# Graph View config
$graphConfig = @'
{
  "collapse-filter": false,
  "search": "",
  "showTags": true,
  "showAttachments": false,
  "hideUnresolved": false,
  "showOrphans": true,
  "collapse-color-groups": false,
  "colorGroups": [
    {"query": "path:10_Zettels", "color": {"a": 1, "rgb": 3066993}},
    {"query": "path:20_MOC", "color": {"a": 1, "rgb": 15158332}},
    {"query": "path:00_Inbox", "color": {"a": 1, "rgb": 3447003}},
    {"query": "path:Sessions", "color": {"a": 1, "rgb": 9936031}}
  ],
  "collapse-display": false,
  "showArrow": true,
  "textFadeMultiplier": 0,
  "nodeSizeMultiplier": 1.5,
  "lineSizeMultiplier": 1,
  "collapse-forces": true,
  "centerStrength": 0.5,
  "repelStrength": 10,
  "linkStrength": 1,
  "linkDistance": 250
}
'@

$obsidianDir = Join-Path $vaultPath ".obsidian"
if (!(Test-Path $obsidianDir)) {
    New-Item -ItemType Directory -Path $obsidianDir -Force | Out-Null
}
$graphConfig | Out-File -Encoding utf8 (Join-Path $obsidianDir "graph.json")
Write-Host "  + Graph View config" -ForegroundColor Green

Write-Host "`nГотово! Откройте vault в Obsidian:" -ForegroundColor Cyan
Write-Host "  $vaultPath" -ForegroundColor White
