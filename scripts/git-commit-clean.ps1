# Save staged changes without Co-authored-by trailers (Cursor sometimes injects them).
# Preferred (cross-platform):
#   Set message in .git/SAVE_MSG.txt (subject line 1, blank line, optional body)
#   git add ...
#   node scripts/git-save-staged.mjs
#
# PowerShell alternative:
#   .\scripts\git-commit-clean.ps1 -Message "feat: short subject" -Body "Optional body."
# Verify: git log -1 --format=full

param(
    [Parameter(Mandatory = $true)]
    [string]$Message,

    [string]$Body = ""
)

$ErrorActionPreference = "Stop"

$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Error "Nothing staged. Run git add first."
}

$tree = git write-tree
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$parent = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$fullMessage = if ($Body.Trim()) { "$Message`n`n$Body" } else { $Message }
$commitFile = New-TemporaryFile
try {
    Set-Content -Path $commitFile -Value $fullMessage -NoNewline
    $newCommit = git commit-tree $tree -p $parent -F $commitFile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    git update-ref HEAD $newCommit
    git reset HEAD
    Write-Host "Created clean commit $newCommit"
    git log -1 --format=full
} finally {
    Remove-Item -Force $commitFile -ErrorAction SilentlyContinue
}
