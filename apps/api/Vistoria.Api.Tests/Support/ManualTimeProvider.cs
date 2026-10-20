namespace Vistoria.Api.Tests.Support;

/// <summary>Relógio que só anda quando o teste manda: prazos (expiração, TTL, cursor) sem esperar de verdade.</summary>
public sealed class ManualTimeProvider(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan delta) => _now += delta;
}
