$API_URL = 'http://localhost:8080'
$API_KEY = 'lite-internal-secret'
$MEET_URL = 'https://meet.google.com/izd-eshg-iqq'

$headers = @{
    'X-API-Key' = $API_KEY
    'Content-Type' = 'application/json'
}

Write-Host '1. Enviando o robo para a reuniao...'
$botBody = @{ meeting_url = $MEET_URL; bot_name = 'Vexa Bot' } | ConvertTo-Json
try {
    $botResponse = Invoke-RestMethod -Uri "$API_URL/api/external/bots" -Method Post -Headers $headers -Body $botBody
    Write-Host 'Response:'
    $botResponse | ConvertTo-Json

    $meetingId = $botResponse.meeting_id
    $platform = $botResponse.platform
    $nativeMeetingId = $botResponse.native_meeting_id
    $transcriptionKey = "$platform/$nativeMeetingId"

    Write-Host 'Aguardando 15 segundos para capturar audio...'
    Start-Sleep -Seconds 15

    Write-Host '2. Transcrevendo a reuniao (parcial)...'
    $transcribeBody = @{ meeting_key = $transcriptionKey } | ConvertTo-Json
    $transcribeResponse = Invoke-RestMethod -Uri "$API_URL/api/external/meetings/$meetingId/transcribe" -Method Post -Headers $headers -Body $transcribeBody
    Write-Host 'Transcription Response:'
    $transcribeResponse | ConvertTo-Json

    Write-Host 'Aguardando mais 5 segundos...'
    Start-Sleep -Seconds 5

    Write-Host '3. Encerrando a reuniao e removendo o robo...'
    $stopResponse = Invoke-RestMethod -Uri "$API_URL/api/external/bots/$platform/$nativeMeetingId/stop" -Method Post -Headers $headers
    Write-Host 'Stop Response:'
    $stopResponse | ConvertTo-Json
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
