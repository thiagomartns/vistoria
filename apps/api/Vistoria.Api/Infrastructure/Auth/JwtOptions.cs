using Microsoft.Extensions.Options;

namespace Vistoria.Api.Infrastructure.Auth;

/// <summary>
/// Seção <c>Jwt</c>. Emissor e audiência ficam no <c>appsettings.json</c>; a chave nunca: User Secrets em dev
/// (gravada pelo <c>pnpm db:init</c>), <c>Jwt__SigningKey</c> no container.
/// </summary>
public sealed class JwtOptions
{
    public const string Section = "Jwt";

    /// <summary>HS256 pede uma chave de pelo menos 256 bits.</summary>
    public const int MinKeyBytes = 32;

    public string Issuer { get; set; } = "";
    public string Audience { get; set; } = "";

    /// <summary>Base64 de pelo menos <see cref="MinKeyBytes"/> bytes aleatórios.</summary>
    public string SigningKey { get; set; } = "";

    public byte[] SigningKeyBytes() => Convert.FromBase64String(SigningKey);
}

public sealed class JwtOptionsValidator : IValidateOptions<JwtOptions>
{
    public ValidateOptionsResult Validate(string? name, JwtOptions options)
    {
        var failures = new List<string>();
        if (string.IsNullOrWhiteSpace(options.Issuer))
        {
            failures.Add($"{JwtOptions.Section}:Issuer não configurado.");
        }

        if (string.IsNullOrWhiteSpace(options.Audience))
        {
            failures.Add($"{JwtOptions.Section}:Audience não configurado.");
        }

        if (string.IsNullOrWhiteSpace(options.SigningKey))
        {
            failures.Add($"{JwtOptions.Section}:SigningKey não configurada. Em dev, rode pnpm db:init (User Secrets).");
        }
        else if (KeyLength(options.SigningKey) is not { } length || length < JwtOptions.MinKeyBytes)
        {
            failures.Add($"{JwtOptions.Section}:SigningKey precisa ser base64 de pelo menos {JwtOptions.MinKeyBytes} bytes.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static int? KeyLength(string base64)
    {
        var buffer = new byte[base64.Length];
        return Convert.TryFromBase64String(base64, buffer, out var written) ? written : null;
    }
}
