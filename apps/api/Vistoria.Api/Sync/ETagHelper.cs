namespace Vistoria.Api.Sync;

/// <summary>
/// Rowversion ↔ ETag forte <c>"&lt;base64&gt;"</c> (backend.md, "Cabeçalhos"). O DTO repete o mesmo base64 sem
/// aspas em <c>version</c>.
/// </summary>
public static class ETagHelper
{
    /// <summary>Tamanho do <c>rowversion</c> do SQL Server.</summary>
    public const int VersionLength = 8;

    public static string ToETag(byte[] version) => $"\"{Convert.ToBase64String(version)}\"";

    /// <summary>
    /// Só aceita ETag forte, entre aspas, com o base64 de um rowversion. ETag fraca (<c>W/"..."</c>), sem aspas,
    /// base64 inválido ou de outro tamanho devolvem <c>false</c>.
    /// </summary>
    public static bool TryParse(string? etag, out byte[] version)
    {
        version = [];
        if (etag is not { Length: > 2 } || etag[0] != '"' || etag[^1] != '"')
        {
            return false;
        }

        var bytes = new byte[VersionLength];
        if (!Convert.TryFromBase64String(etag[1..^1], bytes, out var written) || written != VersionLength)
        {
            return false;
        }

        version = bytes;
        return true;
    }
}
