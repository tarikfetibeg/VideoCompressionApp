[CmdletBinding()]
param(
    [ValidateSet('menu', 'start', 'build', 'build-start', 'check', 'install', 'frontend-test', 'backend-test')]
    [string]$Action = 'menu',
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot

function Get-LauncherSteps {
    param([string]$Name)

    switch ($Name) {
        'start' {
            [pscustomobject]@{ Tool = 'node'; Arguments = @('scripts/startAll.js') }
        }
        'build' {
            [pscustomobject]@{ Tool = 'npm.cmd'; Arguments = @('run', 'build', '--prefix', 'frontend') }
        }
        'build-start' {
            Get-LauncherSteps 'build'
            Get-LauncherSteps 'start'
        }
        'install' {
            [pscustomobject]@{ Tool = 'npm.cmd'; Arguments = @('ci') }
            [pscustomobject]@{ Tool = 'npm.cmd'; Arguments = @('ci', '--prefix', 'frontend') }
        }
        'frontend-test' {
            [pscustomobject]@{
                Tool = 'npm.cmd'
                Arguments = @('test', '--prefix', 'frontend', '--', '--watchAll=false', '--runInBand')
            }
        }
        'backend-test' {
            $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $script:ProjectRoot 'tests/backend') -Filter '*.test.js' -File |
                Sort-Object Name | ForEach-Object { $_.FullName })
            if ($testFiles.Count -eq 0) { throw 'Nisu pronadjeni backend testovi.' }
            [pscustomobject]@{ Tool = 'node'; Arguments = @('--test') + $testFiles }
        }
        default { throw "Nepoznata akcija: $Name" }
    }
}

function Get-ToolPath {
    param([string]$Name)

    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw "Nedostaje $Name u PATH-u. Instaliraj Node.js i npm, pa ponovo otvori launcher." }
    return $command.Source
}

function Assert-NodeRuntime {
    $node = Get-ToolPath 'node'
    $version = & $node --version
    if ($LASTEXITCODE -ne 0) { throw 'Nije moguce provjeriti Node.js verziju.' }
    if ($version -notmatch '^v(\d+)\.') { throw 'Node.js je vratio nepoznatu verziju.' }
    if ([int]$Matches[1] -lt 20) { throw 'Projekat zahtijeva Node.js 20.x. Trenutna verzija je prestara.' }
    if ([int]$Matches[1] -ne 20) {
        Write-Host "UPOZORENJE: instaliran je $version; package.json navodi Node.js 20.x." -ForegroundColor Yellow
    }
}

function Assert-Dependencies {
    param([bool]$Frontend)

    $required = @('node_modules/dotenv-flow/package.json', 'node_modules/express/package.json')
    if ($Frontend) { $required += 'frontend/node_modules/react-scripts/package.json' }
    foreach ($relativePath in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:ProjectRoot $relativePath) -PathType Leaf)) {
            throw 'Nedostaju zavisnosti. Izaberi opciju 5 (instalacija iz lock fajlova).'
        }
    }
}

function Show-EnvironmentCheck {
    Assert-NodeRuntime
    $npm = Get-ToolPath 'npm.cmd'
    Write-Host "Node.js: $(& (Get-ToolPath 'node') --version)"
    Write-Host "npm: $(& $npm --version)"
    foreach ($item in @(
        @{ Name = 'Backend zavisnosti'; Path = 'node_modules/express/package.json' },
        @{ Name = 'Frontend zavisnosti'; Path = 'frontend/node_modules/react-scripts/package.json' },
        @{ Name = 'Frontend build'; Path = 'frontend/build/index.html' }
    )) {
        $exists = Test-Path -LiteralPath (Join-Path $script:ProjectRoot $item.Path) -PathType Leaf
        $status = if ($exists) { 'PRISUTNO' } else { 'NEDOSTAJE' }
        Write-Host "$($item.Name): $status"
    }
    foreach ($tool in @('ffmpeg', 'ffprobe')) {
        $available = Get-Command $tool -CommandType Application -ErrorAction SilentlyContinue
        $status = if ($available) { 'PRISUTNO u PATH-u' } else { 'NIJE PRONADJENO u PATH-u' }
        Write-Host "${tool}: $status"
    }
    $configNames = @('.env', '.env.local')
    if (-not [string]::IsNullOrWhiteSpace($env:NODE_ENV)) {
        $configNames += ".env.$env:NODE_ENV", ".env.$env:NODE_ENV.local"
    }
    $envFiles = @($configNames | Where-Object {
        Test-Path -LiteralPath (Join-Path $script:ProjectRoot $_) -PathType Leaf
    })
    $hasExternalConfig = -not [string]::IsNullOrWhiteSpace($env:MONGODB_URI)
    if ($envFiles.Count -gt 0 -or $hasExternalConfig) {
        Write-Host 'Konfiguracija: pronadjen .env fajl ili MONGODB_URI u okruzenju (vrijednosti su skrivene).'
    } else {
        Write-Host 'UPOZORENJE: nema .env konfiguracije ni MONGODB_URI u okruzenju.' -ForegroundColor Yellow
        Write-Host 'Pripremi vlastiti .env prema .env.example; launcher ga ne kreira niti mijenja.'
    }
    Write-Host 'Ovo je lokalna provjera, ne potvrda ispravnosti konfiguracije, baze, Redis-a ili GPU-a.'
}

function Invoke-LauncherStep {
    param($Step)

    $arguments = @($Step.Arguments)
    Write-Host "`n> $($Step.Tool) $($arguments -join ' ')" -ForegroundColor Cyan
    if ($DryRun) { return }

    $executable = Get-ToolPath $Step.Tool
    & $executable @arguments
    if ($LASTEXITCODE -ne 0) {
        $failure = [System.Exception]::new("Komanda nije uspjela (exit code $LASTEXITCODE). Sljedece komande nisu pokrenute.")
        $failure.Data['ExitCode'] = $LASTEXITCODE
        throw $failure
    }
}

function Invoke-LauncherAction {
    param([string]$Name)

    if ($Name -eq 'check') {
        if ($DryRun) { Write-Host 'Provjera okruzenja (dry-run, bez izvrsavanja).'; return }
        Show-EnvironmentCheck
        return
    }
    $steps = @(Get-LauncherSteps $Name)
    if (-not $DryRun) {
        Assert-NodeRuntime
        if ($Name -eq 'install') {
            foreach ($lock in @('package-lock.json', 'frontend/package-lock.json')) {
                if (-not (Test-Path -LiteralPath (Join-Path $script:ProjectRoot $lock) -PathType Leaf)) {
                    throw "Nedostaje $lock; npm ci nije pokrenut."
                }
            }
            Write-Host 'npm ci ponovo instalira zavisnosti iz lock fajlova i izvrsava njihove install skripte.' -ForegroundColor Yellow
            Write-Host 'Potreban je internet. Verzije iz lock fajlova se ne nadogradjuju.'
            if ((Read-Host 'Upisi INSTALIRAJ za potvrdu') -cne 'INSTALIRAJ') {
                Write-Host 'Instalacija otkazana.'
                return
            }
        } else {
            Assert-Dependencies ($Name -in @('build', 'build-start', 'frontend-test'))
        }
    }
    foreach ($step in $steps) {
        if ($step.Arguments[0] -eq 'scripts/startAll.js' -and -not $DryRun) {
            if (-not (Test-Path -LiteralPath (Join-Path $script:ProjectRoot 'frontend/build/index.html') -PathType Leaf)) {
                throw 'Frontend build ne postoji. Izaberi opciju 2 ili 3 prije pokretanja.'
            }
            Write-Host 'Aplikacija radi u ovom prozoru. Za zaustavljanje koristi Ctrl+C.' -ForegroundColor Yellow
            Write-Host 'Prije gasenja pricekaj zavrsetak aktivnih obrada i transfera.'
            Write-Host 'Adresa je obicno http://localhost:5000; konacni port prikazuje server (PORT iz konfiguracije).'
            Write-Host 'Zauzet port se ne oslobadja automatski. Redis, MongoDB i firewall se ne mijenjaju.'
        }
        Invoke-LauncherStep $step
    }
}

$originalLocation = Get-Location
$launcherExit = 0
try {
    Set-Location -LiteralPath $script:ProjectRoot
    if ($Action -ne 'menu') {
        Invoke-LauncherAction $Action
    } elseif ($DryRun) {
        Write-Host 'Dry-run zahtijeva konkretnu akciju, npr. -Action build -DryRun.'
    } else {
        $choices = @{
            '1' = 'start'; '2' = 'build'; '3' = 'build-start'; '4' = 'check'
            '5' = 'install'; '6' = 'frontend-test'; '7' = 'backend-test'
        }
        while ($true) {
            Write-Host "`nVideoCompressionApp - brze komande" -ForegroundColor Cyan
            Write-Host "Folder: $script:ProjectRoot"
            Write-Host '1  Pokreni aplikaciju (postojeci build)'
            Write-Host '2  Kompajliraj frontend'
            Write-Host '3  Kompajliraj frontend pa pokreni aplikaciju'
            Write-Host '4  Provjeri lokalno okruzenje'
            Write-Host '5  Instaliraj zavisnosti (npm ci, uz potvrdu)'
            Write-Host '6  Frontend testovi (bez watch moda)'
            Write-Host '7  Backend unit testovi (bez dugotrajnih QA ciklusa)'
            Write-Host '0  Izlaz'
            $choice = Read-Host 'Izbor'
            if ($choice -eq '0' -or $null -eq $choice) { break }
            if (-not $choices.ContainsKey($choice)) { Write-Host 'Nepoznat izbor.'; continue }
            try {
                Invoke-LauncherAction $choices[$choice]
                Write-Host "`nAkcija zavrsena." -ForegroundColor Green
            } catch {
                Write-Host "`nGRESKA: $($_.Exception.Message)" -ForegroundColor Red
            }
            [void](Read-Host 'Enter za povratak u meni')
        }
    }
} catch {
    Write-Host "`nGRESKA: $($_.Exception.Message)" -ForegroundColor Red
    $launcherExit = if ($_.Exception.Data.Contains('ExitCode')) { [int]$_.Exception.Data['ExitCode'] } else { 1 }
} finally {
    Set-Location -LiteralPath $originalLocation.Path
}
exit $launcherExit
