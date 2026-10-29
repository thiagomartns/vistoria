namespace Vistoria.Api.Configurations;

/// <summary>Prazos e limites do delta de backend.md, "Parâmetros compartilhados".</summary>
public static class SyncConfig
{
    /// <summary>
    /// Retenção de tombstones. Um cursor mais velho que ela pode ter perdido exclusões já purgadas: 410
    /// <c>cursor-expired</c>.
    /// </summary>
    public static readonly TimeSpan TombstoneRetention = TimeSpan.FromDays(90);

    /// <summary>Página do delta sem <c>limit</c>.</summary>
    public const int DefaultPageSize = 500;

    /// <summary>Maior <c>limit</c> aceito; acima disso, 400 <c>validation</c>.</summary>
    public const int MaxPageSize = 1000;
}
