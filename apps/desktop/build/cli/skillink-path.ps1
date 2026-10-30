param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('add', 'remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$CliDir
)

$current = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $current) {
  $current = ''
}

$entries = @(
  $current -split ';' |
    Where-Object { $_ -ne '' -and $_ -ne $CliDir }
)

if ($Action -eq 'add') {
  $entries = @($CliDir) + $entries
}

[Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
