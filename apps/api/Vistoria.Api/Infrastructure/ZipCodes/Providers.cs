using System.Net;
using System.Text.Json;

namespace Vistoria.Api.Infrastructure.ZipCodes;

/// <summary>
/// ViaCEP: <c>GET ws/{cep}/json/</c>. O CEP que não existe responde 200 com <c>{ "erro": true }</c> (ou
/// <c>"true"</c>, em texto), não 404.
/// </summary>
public sealed class ViaCepLookup(HttpClient client) : IZipCodeLookup
{
    public async Task<ProviderAddress?> FindAsync(string zipCode, CancellationToken cancellationToken)
    {
        using var response = await client.GetAsync($"ws/{zipCode}/json/", cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new ZipCodeProviderException($"ViaCEP respondeu {(int)response.StatusCode}.");
        }

        using var body = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        var root = body.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ZipCodeProviderException("ViaCEP respondeu algo que não é um objeto.");
        }

        if (root.TryGetProperty("erro", out var error)
            && (error.ValueKind == JsonValueKind.True
                || (error.ValueKind == JsonValueKind.String && error.GetString() == "true")))
        {
            return null;
        }

        return new ProviderAddress(
            Text(root, "logradouro"), Text(root, "bairro"), Text(root, "localidade"), Text(root, "uf"));
    }

    internal static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}

/// <summary>BrasilAPI: <c>GET api/cep/v2/{cep}</c>, que responde 404 quando nenhum dos provedores dela tem o CEP.</summary>
public sealed class BrasilApiLookup(HttpClient client) : IZipCodeLookup
{
    public async Task<ProviderAddress?> FindAsync(string zipCode, CancellationToken cancellationToken)
    {
        using var response = await client.GetAsync($"api/cep/v2/{zipCode}", cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new ZipCodeProviderException($"BrasilAPI respondeu {(int)response.StatusCode}.");
        }

        using var body = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        var root = body.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ZipCodeProviderException("BrasilAPI respondeu algo que não é um objeto.");
        }

        return new ProviderAddress(
            ViaCepLookup.Text(root, "street"),
            ViaCepLookup.Text(root, "neighborhood"),
            ViaCepLookup.Text(root, "city"),
            ViaCepLookup.Text(root, "state"));
    }
}

/// <summary>
/// O ViaCEP primeiro; a BrasilAPI quando ele falha ou não conhece o CEP (ela junta vários provedores e costuma ter
/// antes os CEPs novos). "Não existe" só quando nenhum dos que responderam conhece o CEP; os dois fora →
/// <see cref="Errors.UpstreamUnavailableException"/>.
/// </summary>
public sealed partial class FallbackZipCodeLookup(
    ViaCepLookup viaCep, BrasilApiLookup brasilApi, ILogger<FallbackZipCodeLookup> logger) : IZipCodeLookup
{
    public async Task<ProviderAddress?> FindAsync(string zipCode, CancellationToken cancellationToken)
    {
        var viaCepAnswered = false;
        try
        {
            var address = await viaCep.FindAsync(zipCode, cancellationToken);
            if (address is not null)
            {
                return address;
            }

            viaCepAnswered = true;
        }
        catch (Exception exception) when (ZipCodeLookupFailure.Is(exception, cancellationToken))
        {
            LogProviderFailed(logger, "ViaCEP", exception.GetType().Name, exception.Message);
        }

        try
        {
            return await brasilApi.FindAsync(zipCode, cancellationToken);
        }
        catch (Exception exception) when (ZipCodeLookupFailure.Is(exception, cancellationToken))
        {
            LogProviderFailed(logger, "BrasilAPI", exception.GetType().Name, exception.Message);
            // O ViaCEP já disse que o CEP não existe: essa resposta vale mais do que nenhuma.
            return viaCepAnswered ? null : throw new Errors.UpstreamUnavailableException("Nenhum provedor de CEP respondeu.");
        }
    }

    // Sem o CEP no log: ele é do imóvel de um cliente.
    [LoggerMessage(Level = LogLevel.Warning, Message = "Provedor de CEP {Provider} falhou: {Error}: {Detail}")]
    private static partial void LogProviderFailed(ILogger logger, string provider, string error, string detail);
}
