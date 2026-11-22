namespace Vistoria.Api.Data.DTO.V1;

/// <summary>
/// O endereço de um CEP, já no formato do <c>Property</c> (#185): CEP com 8 dígitos, UF em maiúsculas e cada campo
/// cortado no tamanho do modelo. O que o provedor não traz vem nulo: o CEP geral de uma cidade pequena não tem rua nem
/// bairro. É só uma sugestão: o front preenche com ele os campos vazios, e o servidor não confere o endereço gravado.
/// </summary>
public sealed record ZipCodeAddressDto(
    string ZipCode,
    string? Street,
    string? District,
    string? City,
    string? State);
