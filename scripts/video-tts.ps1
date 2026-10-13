# 演示视频旁白合成（Windows 内置语音，无网络依赖）。
# 用法（由 video-tts.mjs 调用，亦可手动）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File video-tts.ps1 -In 文本.txt -Out 音频.wav -Rate -1
param(
    [Parameter(Mandatory = $true)][string]$In,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Rate = -1
)

Add-Type -AssemblyName System.Speech

$text = Get-Content -Raw -Encoding UTF8 $In
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Huihui Desktop")
$synth.Rate = $Rate
$synth.SetOutputToWaveFile($Out)
$synth.Speak($text)
$synth.Dispose()
