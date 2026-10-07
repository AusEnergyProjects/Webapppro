param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$fixtureDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $fixtureDirectory -Force | Out-Null
$fixtures = @(
    @{ Name = 'council-overview'; Text = 'Hello Wattzun. I am preparing for a council housing program. What can you help me do in the council portal?' },
    @{ Name = 'council-refer-property'; Text = 'Please help me prepare a property referral. What details do you need from me?' },
    @{ Name = 'council-no-invention'; Text = 'The resident gave me only a surname and I am not sure of the address. Can you fill in the missing details for me?' },
    @{ Name = 'council-next-step'; Text = 'I do not want to submit anything yet. Please explain the next step and what I need to check.' },
    @{ Name = 'council-invitation'; Text = 'Please draft a short resident invitation to an energy information session at Example Community Hall on Saturday the twenty fourth of October at ten a m, and leave bookings as contact the council team, this is only a draft and must not be published.' },
    @{ Name = 'council-correction'; Text = 'Please change the venue in that invitation to Example Library and make it clear residents can ask about heat pump rebates, keep the same date and time and do not publish it.' },
    @{ Name = 'council-report'; Text = 'Please summarise the selected council report for a briefing and distinguish TLink recorded activity from public community installation counts and lifetime estimates from annual measured emissions.' },
    @{ Name = 'trade-quote'; Text = 'Please prepare a quote for a switchboard inspection. The customer name is Alex Test, spelt A L E X, T E S T.' },
    @{ Name = 'trade-quote-detail'; Text = 'Add one labour item called switchboard inspection at one hundred and twenty dollars excluding G S T. Do not save or send it yet.' },
    @{ Name = 'trade-price-correction'; Text = 'Correction, the switchboard inspection labour price should be one hundred and fifty dollars excluding G S T, with a quantity of two, keep the customer name and do not save or send it yet.' },
    @{ Name = 'creditex-evidence'; Text = 'Help me review the evidence for an audit. Tell me which saved source you need before making a compliance decision.' },
    @{ Name = 'off-topic'; Text = 'What is the best restaurant near me tonight?' }
)
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synthesizer.SelectVoice('Microsoft David Desktop')
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    foreach ($fixture in $fixtures) {
        $destinationPath = Join-Path $fixtureDirectory ($fixture.Name + '.wav')
        $synthesizer.SetOutputToWaveFile($destinationPath, $format)
        $synthesizer.Speak($fixture.Text)
        $synthesizer.SetOutputToNull()
        # SAPI writes an 18-byte fmt chunk. Reframe its PCM into the exact native
        # Wattzun 44-byte WAV contract without resampling or changing samples.
        $wave = [System.IO.File]::ReadAllBytes($destinationPath)
        $dataOffset = -1
        $dataLength = 0
        for ($offset = 12; $offset + 8 -le $wave.Length;) {
            $chunkLength = [BitConverter]::ToUInt32($wave, $offset + 4)
            $chunkName = [System.Text.Encoding]::ASCII.GetString($wave, $offset, 4)
            if ($chunkName -eq 'fmt ') {
                if ([BitConverter]::ToUInt16($wave, $offset + 8) -ne 1 -or [BitConverter]::ToUInt16($wave, $offset + 10) -ne 1 -or [BitConverter]::ToUInt32($wave, $offset + 12) -ne 24000 -or [BitConverter]::ToUInt16($wave, $offset + 22) -ne 16) { throw 'Synthetic speech format is not PCM16 mono 24 kHz.' }
            }
            if ($chunkName -eq 'data') { $dataOffset = $offset + 8; $dataLength = $chunkLength; break }
            $offset += 8 + $chunkLength + ($chunkLength % 2)
        }
        if ($dataOffset -lt 0 -or $dataLength % 2 -ne 0 -or $dataOffset + $dataLength -gt $wave.Length) { throw 'Synthetic speech has invalid PCM data.' }
        $canonical = New-Object System.IO.MemoryStream
        $writer = New-Object System.IO.BinaryWriter($canonical)
        try {
            $writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF')); $writer.Write([uint32]($dataLength + 36))
            $writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $writer.Write([uint32]16)
            $writer.Write([uint16]1); $writer.Write([uint16]1); $writer.Write([uint32]24000); $writer.Write([uint32]48000)
            $writer.Write([uint16]2); $writer.Write([uint16]16)
            $writer.Write([System.Text.Encoding]::ASCII.GetBytes('data')); $writer.Write([uint32]$dataLength)
            $writer.Write($wave, $dataOffset, $dataLength); $writer.Flush()
            [System.IO.File]::WriteAllBytes($destinationPath, $canonical.ToArray())
        } finally { $writer.Dispose(); $canonical.Dispose() }
    }
    $fixtures | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $fixtureDirectory 'wattzun-voice-eval-manifest.json') -Encoding UTF8
    [pscustomobject]@{ FixtureCount = $fixtures.Count; Directory = $fixtureDirectory; Source = 'Offline synthetic speech'; SampleRate = 24000; Channels = 1; Bits = 16 } | ConvertTo-Json -Compress
} finally { $synthesizer.Dispose() }
