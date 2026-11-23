using System.ComponentModel;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Hybrid;
using Vistoria.Api.Configurations;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Infrastructure.Validation;
using Vistoria.Api.Infrastructure.ZipCodes;
using Vistoria.Api.Model.Configurations;

namespace Vistoria.Api.Services.Impl;

/// <summary>
/// A consulta do CEP (#185). O resultado fica no cache em memória, com prazos de backend.md, "Parâmetros
/// compartilhados": o encontrado por mais tempo, o "não existe" por menos. A falha dos provedores não entra no cache,
/// porque a fábrica lança.
/// </summary>
public sealed partial class ZipCodeService(IZipCodeLookup lookup, HybridCache cache) : IZipCodeService
{
    private static readonly HybridCacheEntryOptions Found = new()
    {
        Expiration = ZipCodeConfig.FoundCacheDuration,
        LocalCacheExpiration = ZipCodeConfig.FoundCacheDuration,
    };

    private static readonly HybridCacheEntryOptions NotFound = new()
    {
        Expiration = ZipCodeConfig.NotFoundCacheDuration,
        LocalCacheExpiration = ZipCodeConfig.NotFoundCacheDuration,
    };

    public async Task<ZipCodeAddressDto> FindAsync(string zipCode, CancellationToken cancellationToken)
    {
        // [0-9], não \d: no .NET o \d aceita dígitos de qualquer escrita Unicode (como o UpsertPropertyDto).
        if (!ZipCodeFormat().IsMatch(zipCode))
        {
            throw new ValidationException("zipCode", "Informe o CEP com 8 dígitos, sem hífen.");
        }

        var key = $"zip-code:{zipCode}";
        var fetched = false;
        var entry = await cache.GetOrCreateAsync(
            key,
            async ct =>
            {
                fetched = true;
                var address = await lookup.FindAsync(zipCode, ct);
                return new CachedZipCode(address is null ? null : Normalize(zipCode, address));
            },
            Found,
            cancellationToken: cancellationToken);

        if (entry.Address is null)
        {
            // O GetOrCreateAsync grava com um prazo só; o "não existe" recém-consultado é regravado com o dele.
            if (fetched)
            {
                await cache.SetAsync(key, entry, NotFound, cancellationToken: cancellationToken);
            }

            throw new NotFoundException("Nenhum provedor conhece este CEP.");
        }

        return entry.Address;
    }

    private static ZipCodeAddressDto Normalize(string zipCode, ProviderAddress address)
    {
        var state = Clip(address.State, 2)?.ToUpperInvariant();
        return new ZipCodeAddressDto(
            zipCode,
            Clip(address.Street, PropertyConfiguration.StreetMaxLength),
            Clip(address.District, PropertyConfiguration.DistrictMaxLength),
            Clip(address.City, PropertyConfiguration.CityMaxLength),
            state is not null && UfAttribute.All.Contains(state) ? state : null);
    }

    /// <summary>Sem espaço nas pontas, cortado em <paramref name="max"/>; vazio vira <c>null</c>.</summary>
    private static string? Clip(string? value, int max)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length <= max ? trimmed : trimmed[..max].TrimEnd();
    }

    [GeneratedRegex("^[0-9]{8}$")]
    private static partial Regex ZipCodeFormat();
}

/// <summary>O que fica no cache: o endereço, ou <c>null</c> para o "não existe".</summary>
[ImmutableObject(true)]
public sealed record CachedZipCode(ZipCodeAddressDto? Address);
