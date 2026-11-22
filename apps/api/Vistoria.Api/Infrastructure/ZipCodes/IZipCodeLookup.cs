namespace Vistoria.Api.Infrastructure.ZipCodes;

/// <summary>O endereço como o provedor o devolveu, sem normalizar (quem normaliza é o <c>ZipCodeService</c>).</summary>
public sealed record ProviderAddress(string? Street, string? District, string? City, string? State);

/// <summary>Um provedor de CEP (#185).</summary>
public interface IZipCodeLookup
{
    /// <summary>
    /// O endereço de <paramref name="zipCode"/> (8 dígitos), ou <c>null</c> se o provedor diz que o CEP não existe.
    /// Provedor fora (rede, timeout, 5xx, circuito aberto, resposta ilegível) → <see cref="ZipCodeProviderException"/>
    /// ou a exceção da rede, que <see cref="ZipCodeLookupFailure.Is"/> reconhece.
    /// </summary>
    Task<ProviderAddress?> FindAsync(string zipCode, CancellationToken cancellationToken);
}

/// <summary>O provedor respondeu algo que não é nem o endereço nem o "não existe".</summary>
public sealed class ZipCodeProviderException(string message) : Exception(message);

public static class ZipCodeLookupFailure
{
    /// <summary>
    /// A falha esperada de um provedor, que passa para o próximo. O cancelamento de quem pediu não conta: ele sobe
    /// como está. Qualquer outra exceção é bug e sobe como <c>internal</c>.
    /// </summary>
    public static bool Is(Exception exception, CancellationToken cancellationToken) => exception switch
    {
        OperationCanceledException => !cancellationToken.IsCancellationRequested,
        ZipCodeProviderException or HttpRequestException or System.Text.Json.JsonException
            or Polly.ExecutionRejectedException => true,
        _ => false,
    };
}
