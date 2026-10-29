using System.Buffers.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vistoria.Api.Sync;

/// <summary>
/// Cursor do delta (backend.md, "Leitura por delta"): o rowversion da última raiz enviada e quando o aparelho o
/// recebeu, num base64url opaco de <c>{ version, issuedAt }</c>. Base64url para ir na query string sem escape.
/// </summary>
public sealed record SyncCursor(byte[] Version, DateTimeOffset IssuedAt)
{
    /// <summary>O começo de tudo: o primeiro sync, com o cursor vazio.</summary>
    public static SyncCursor Start(DateTimeOffset issuedAt) => new(new byte[ETagHelper.VersionLength], issuedAt);

    public string Encode() =>
        Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(
            new Payload(Convert.ToBase64String(Version), IssuedAt)));

    /// <summary>
    /// Base64url inválido, JSON que não é o do cursor ou versão que não é o base64 de um rowversion devolvem
    /// <c>false</c>.
    /// </summary>
    public static bool TryParse(string? value, out SyncCursor cursor)
    {
        cursor = Start(default);
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        Payload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<Payload>(Base64Url.DecodeFromChars(value));
        }
        catch (Exception e) when (e is FormatException or JsonException)
        {
            return false;
        }

        var version = new byte[ETagHelper.VersionLength];
        if (payload?.Version is not { } encoded
            || payload.IssuedAt is not { } issuedAt
            || !Convert.TryFromBase64String(encoded, version, out var written)
            || written != ETagHelper.VersionLength)
        {
            return false;
        }

        cursor = new SyncCursor(version, issuedAt);
        return true;
    }

    // Nomes curtos e fixos: o cursor é opaco para o front, mas não muda de forma sem querer.
    private sealed record Payload(
        [property: JsonPropertyName("version")] string? Version,
        [property: JsonPropertyName("issuedAt")] DateTimeOffset? IssuedAt);
}
